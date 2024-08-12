import { Table } from "../schema-builder/table/Table"
import { DataSource } from "../data-source/DataSource"
import { Migration } from "./Migration"
import { ObjectLiteral } from "../common/ObjectLiteral"
import { QueryRunner } from "../query-runner/QueryRunner"
import { MssqlParameter } from "../driver/sqlserver/MssqlParameter"
import { MongoQueryRunner } from "../driver/mongodb/MongoQueryRunner"
import { ForbiddenTransactionModeOverrideError, TypeORMError } from "../error"
import { InstanceChecker } from "../util/InstanceChecker"

/**
 * Executes migrations: runs pending and reverts previously executed migrations.
 */
export class MigrationExecutor {
    // -------------------------------------------------------------------------
    // Public Properties
    // -------------------------------------------------------------------------

    /**
     * Indicates how migrations should be run in transactions.
     *   all: all migrations are run in a single transaction
     *   none: all migrations are run without a transaction
     *   each: each migration is run in a separate transaction
     */
    transaction: "all" | "none" | "each" = "all"

    /**
     * Option to fake-run or fake-revert a migration, adding to the
     * executed migrations table, but not actually running it. This feature is
     * useful for when migrations are added after the fact or for
     * interoperability between applications which are desired to each keep
     * a consistent migration history.
     */
    fake: boolean

    // -------------------------------------------------------------------------
    // Private Properties
    // -------------------------------------------------------------------------

    private readonly migrationsDatabase?: string
    private readonly migrationsSchema?: string
    private readonly migrationsTable: string
    private readonly migrationsTableName: string

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        protected connection: DataSource,
        protected queryRunner?: QueryRunner,
    ) {
        const { schema } = this.connection.driver.options as any
        const database = this.connection.driver.database
        this.migrationsDatabase = database
        this.migrationsSchema = schema
        this.migrationsTableName =
            connection.options.migrationsTableName || "migrations"
        this.migrationsTable = this.connection.driver.buildTableName(
            this.migrationsTableName,
            schema,
            database,
        )
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Tries to execute a single migration given.
     */
    public async executeMigration(migration: Migration): Promise<Migration> {
        return this.withQueryRunner(async (queryRunner) => {
            await this.createMigrationsTableIfNotExist(queryRunner)

            // create typeorm_metadata table if it's not created yet
            const schemaBuilder = this.connection.driver.createSchemaBuilder()
            if (InstanceChecker.isRdbmsSchemaBuilder(schemaBuilder)) {
                await schemaBuilder.createMetadataTableIfNecessary(queryRunner)
            }

            await queryRunner.beforeMigration()
            await (migration.instance as any).up(queryRunner)
            await queryRunner.afterMigration()
            await this.insertExecutedMigration(queryRunner, migration)

            return migration
        })
    }

    /**
     * Returns an array of all migrations.
     */
    public async getAllMigrations(): Promise<Migration[]> {
        return Promise.resolve(this.getMigrations())
    }

    /**
     * Returns an array of all executed migrations.
     */
    public async getExecutedMigrations(): Promise<Migration[]> {
        return this.withQueryRunner(async (queryRunner) => {
            await this.createMigrationsTableIfNotExist(queryRunner)

            return await this.loadExecutedMigrations(queryRunner)
        })
    }

    /**
     * Returns an array of all pending migrations.
     */
    public async getPendingMigrations(): Promise<Migration[]> {
        const allMigrations = await this.getAllMigrations()
        const executedMigrations = await this.getExecutedMigrations()

        return allMigrations.filter(
            (migration) =>
                !executedMigrations.find(
                    (executedMigration) =>
                        executedMigration.name === migration.name,
                ),
        )
    }

    /**
     * Inserts an executed migration.
     */
    public insertMigration(migration: Migration): Promise<void> {
        return this.withQueryRunner((q) =>
            this.insertExecutedMigration(q, migration),
        )
    }

    /**
     * Deletes an executed migration.
     */
    public deleteMigration(migration: Migration): Promise<void> {
        return this.withQueryRunner((q) =>
            this.deleteExecutedMigration(q, migration),
        )
    }

    /**
     * Lists all migrations and whether they have been executed or not
     * returns true if there are unapplied migrations
     */
    async showMigrations(): Promise<boolean> {
        let hasUnappliedMigrations = false
        const queryRunner =
            this.queryRunner || this.connection.createQueryRunner()
        // create migrations table if its not created yet
        await this.createMigrationsTableIfNotExist(queryRunner)

        // get all migrations that are executed and saved in the database
        const executedMigrations = await this.loadExecutedMigrations(
            queryRunner,
        )

        // get all user's migrations in the source code
        const allMigrations = this.getMigrations()

        for (const migration of allMigrations) {
            const executedMigration = executedMigrations.find(
                (executedMigration) =>
                    executedMigration.name === migration.name,
            )

            if (executedMigration) {
                this.connection.logger.logSchemaBuild(
                    `[X] ${executedMigration.id} ${migration.name}`,
                )
            } else {
                hasUnappliedMigrations = true
                this.connection.logger.logSchemaBuild(`[ ] ${migration.name}`)
            }
        }

        // if query runner was created by us then release it
        if (!this.queryRunner) {
            await queryRunner.release()
        }

        return hasUnappliedMigrations
    }

    /**
     * Executes all pending migrations. Pending migrations are migrations that are not yet executed,
     * thus not saved in the database.
     */
    async executePendingMigrations(): Promise<Migration[]> {
        const queryRunner =
            this.queryRunner || this.connection.createQueryRunner()
        // create migrations table if it's not created yet
        await this.createMigrationsTableIfNotExist(queryRunner)

        // create the typeorm_metadata table if it's not created yet
        const schemaBuilder = this.connection.driver.createSchemaBuilder()
        if (InstanceChecker.isRdbmsSchemaBuilder(schemaBuilder)) {
            await schemaBuilder.createMetadataTableIfNecessary(queryRunner)
        }

        // get all migrations that are executed and saved in the database
        const executedMigrations = await this.loadExecutedMigrations(
            queryRunner,
        )

        // get the time when last migration was executed
        let lastTimeExecutedMigration =
            this.getLatestTimestampMigration(executedMigrations)

        // get all user's migrations in the source code
        const allMigrations = this.getMigrations()

        // variable to store all migrations we did successfully
        const successMigrations: Migration[] = []

        // find all migrations that needs to be executed
        const pendingMigrations = allMigrations.filter((migration) => {
            // check if we already have executed migration
            const executedMigration = executedMigrations.find(
                (executedMigration) =>
                    executedMigration.name === migration.name,
            )
            if (executedMigration) return false

            // migration is new and not executed. now check if its timestamp is correct
            // if (lastTimeExecutedMigration && migration.timestamp < lastTimeExecutedMigration.timestamp)
            //     throw new TypeORMError(`New migration found: ${migration.name}, however this migration's timestamp is not valid. Migration's timestamp should not be older then migrations already executed in the database.`);

            // every check is passed means that migration was not run yet and we need to run it
            return true
        })

        // if no migrations are pending then nothing to do here
        if (!pendingMigrations.length) {
            this.connection.logger.logSchemaBuild(`No migrations are pending`)
            // if query runner was created by us then release it
            if (!this.queryRunner) await queryRunner.release()
            return []
        }

        // log information about migration execution
        this.connection.logger.logSchemaBuild(
            `${executedMigrations.length} migrations are already loaded in the database.`,
        )
        this.connection.logger.logSchemaBuild(
            `${allMigrations.length} migrations were found in the source code.`,
        )
        if (lastTimeExecutedMigration)
            this.connection.logger.logSchemaBuild(
                `${
                    lastTimeExecutedMigration.name
                } is the last executed migration. It was executed on ${new Date(
                    lastTimeExecutedMigration.timestamp,
                ).toString()}.`,
            )
        this.connection.logger.logSchemaBuild(
            `${pendingMigrations.length} migrations are new migrations must be executed.`,
        )

        if (this.transaction === "all") {
            // If we desire to run all migrations in a single transaction
            // but there is a migration that explicitly overrides the transaction mode
            // then we have to fail since we cannot properly resolve that intent
            // In theory we could support overrides that are set to `true`,
            // however to keep the interface more rigid, we fail those too
            const migrationsOverridingTransactionMode =
                pendingMigrations.filter(
                    (migration) =>
                        !(migration.instance?.transaction === undefined),
                )

            if (migrationsOverridingTransactionMode.length > 0) {
                const error = new ForbiddenTransactionModeOverrideError(
                    migrationsOverridingTransactionMode,
                )
                this.connection.logger.logMigration(
                    `Migrations failed, error: ${error.message}`,
                )
                throw error
            }
        }

        // Set the per-migration defaults for the transaction mode
        // so that we have one centralized place that controls this behavior

        // When transaction mode is `each` the default is to run in a transaction
        // When transaction mode is `none` the default is to not run in a transaction
        // When transaction mode is `all` the default is to not run in a transaction
        // since all the migrations are already running in one single transaction

        const txModeDefault = {
            each: true,
            none: false,
            all: false,
        }[this.transaction]

        for (const migration of pendingMigrations) {
            if (migration.instance) {
                const instanceTx = migration.instance.transaction

                if (instanceTx === undefined) {
                    migration.transaction = txModeDefault
                } else {
                    migration.transaction = instanceTx
                }
            }
        }

        // start transaction if its not started yet
        let transactionStartedByUs = false
        if (this.transaction === "all" && !queryRunner.isTransactionActive) {
            await queryRunner.beforeMigration()
            await queryRunner.startTransaction()
            transactionStartedByUs = true
        }

        // run all pending migrations in a sequence
        try {
            for (const migration of pendingMigrations) {
                if (this.fake) {
                    // directly insert migration record into the database if it is fake
                    await this.insertExecutedMigration(queryRunner, migration)

                    // nothing else needs to be done, continue to next migration
                    continue
                }

                if (migration.transaction && !queryRunner.isTransactionActive) {
                    await queryRunner.beforeMigration()
                    await queryRunner.startTransaction()
                    transactionStartedByUs = true
                }

                await migration
                    .instance!.up(queryRunner)
                    .catch((error) => {
                        // informative log about migration failure
                        this.connection.logger.logMigration(
                            `Migration "${migration.name}" failed, error: ${error?.message}`,
                        )
                        throw error
                    })
                    .then(async () => {
                        // now when migration is executed we need to insert record about it into the database
                        await this.insertExecutedMigration(
                            queryRunner,
                            migration,
                        )
                        // commit transaction if we started it
                        if (migration.transaction && transactionStartedByUs) {
                            await queryRunner.commitTransaction()
                            await queryRunner.afterMigration()
                        }
                    })
                    .then(() => {
                        // informative log about migration success
                        successMigrations.push(migration)
                        this.connection.logger.logSchemaBuild(
                            `Migration ${migration.name} has been ${
                                this.fake ? "(fake)" : ""
                            } executed successfully.`,
                        )
                    })
            }

            // commit transaction if we started it
            if (this.transaction === "all" && transactionStartedByUs) {
                await queryRunner.commitTransaction()
                await queryRunner.afterMigration()
            }
        } catch (err) {
            // rollback transaction if we started it
            if (transactionStartedByUs) {
                try {
                    // we throw original error even if rollback thrown an error
                    await queryRunner.rollbackTransaction()
                } catch (rollbackError) {}
            }

            throw err
        } finally {
            // if query runner was created by us then release it
            if (!this.queryRunner) await queryRunner.release()
        }
        return successMigrations
    }

    /**
     * Reverts last migration that were run.
     */
    async undoLastMigration(): Promise<void> {
        const queryRunner =
            this.queryRunner || this.connection.createQueryRunner()

        // create migrations table if it's not created yet
        await this.createMigrationsTableIfNotExist(queryRunner)

        // create typeorm_metadata table if it's not created yet
        const schemaBuilder = this.connection.driver.createSchemaBuilder()
        if (InstanceChecker.isRdbmsSchemaBuilder(schemaBuilder)) {
            await schemaBuilder.createMetadataTableIfNecessary(queryRunner)
        }

        // get all migrations that are executed and saved in the database
        const executedMigrations = await this.loadExecutedMigrations(
            queryRunner,
        )

        // get the time when last migration was executed
        let lastTimeExecutedMigration =
            this.getLatestExecutedMigration(executedMigrations)

        // if no migrations found in the database then nothing to revert
        if (!lastTimeExecutedMigration) {
            this.connection.logger.logSchemaBuild(
                `No migrations were found in the database. Nothing to revert!`,
            )
            return
        }

        // get all user's migrations in the source code
        const allMigrations = this.getMigrations()

        // find the instance of the migration we need to remove
        const migrationToRevert = allMigrations.find(
            (migration) => migration.name === lastTimeExecutedMigration!.name,
        )

        // if no migrations found in the database then nothing to revert
        if (!migrationToRevert)
            throw new TypeORMError(
                `No migration ${lastTimeExecutedMigration.name} was found in the source code. Make sure you have this migration in your codebase and its included in the connection options.`,
            )

        // log information about migration execution
        this.connection.logger.logSchemaBuild(
            `${executedMigrations.length} migrations are already loaded in the database.`,
        )
        this.connection.logger.logSchemaBuild(
            `${
                lastTimeExecutedMigration.name
            } is the last executed migration. It was executed on ${new Date(
                lastTimeExecutedMigration.timestamp,
            ).toString()}.`,
        )
        this.connection.logger.logSchemaBuild(`Now reverting it...`)

        // start transaction if its not started yet
        let transactionStartedByUs = false
        if (this.transaction !== "none" && !queryRunner.isTransactionActive) {
            await queryRunner.startTransaction()
            transactionStartedByUs = true
        }

        try {
            if (!this.fake) {
                await queryRunner.beforeMigration()
                await migrationToRevert.instance!.down(queryRunner)
                await queryRunner.afterMigration()
            }

            await this.deleteExecutedMigration(queryRunner, migrationToRevert)
            this.connection.logger.logSchemaBuild(
                `Migration ${migrationToRevert.name} has been ${
                    this.fake ? "(fake)" : ""
                } reverted successfully.`,
            )

            // commit transaction if we started it
            if (transactionStartedByUs) await queryRunner.commitTransaction()
        } catch (err) {
            // rollback transaction if we started it
            if (transactionStartedByUs) {
                try {
                    // we throw original error even if rollback thrown an error
                    await queryRunner.rollbackTransaction()
                } catch (rollbackError) {}
            }

            throw err
        } finally {
            // if query runner was created by us then release it
            if (!this.queryRunner) await queryRunner.release()
        }
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    /**
     * Creates table "migrations" that will store information about executed migrations.
     */
    protected async createMigrationsTableIfNotExist(
        queryRunner: QueryRunner,
    ): Promise<void> {
        // If driver is mongo no need to create
        if (this.connection.driver.options.type === "mongodb") {
            return
        }
        const tableExist = await queryRunner.hasTable(this.migrationsTable) // todo: table name should be configurable
        if (!tableExist) {
            await queryRunner.createTable(
                new Table({
                    database: this.migrationsDatabase,
                    schema: this.migrationsSchema,
                    name: this.migrationsTable,
                    columns: [
                        {
                            name: "id",
                            type: this.connection.driver.normalizeType({
                                type: this.connection.driver.mappedDataTypes
                                    .migrationId,
                            }),
                            isGenerated: true,
                            generationStrategy: "increment",
                            isPrimary: true,
                            isNullable: false,
                        },
                        {
                            name: "timestamp",
                            type: this.connection.driver.normalizeType({
                                type: this.connection.driver.mappedDataTypes
                                    .migrationTimestamp,
                            }),
                            isPrimary: false,
                            isNullable: false,
                        },
                        {
                            name: "name",
                            type: this.connection.driver.normalizeType({
                                type: this.connection.driver.mappedDataTypes
                                    .migrationName,
                            }),
                            isNullable: false,
                        },
                    ],
                }),
            )
        }
    }

    /**
     * Loads all migrations that were executed and saved into the database (sorts by id).
     */
    protected async loadExecutedMigrations(
        queryRunner: QueryRunner,
    ): Promise<Migration[]> {
        if (this.connection.driver.options.type === "mongodb") {
            const mongoRunner = queryRunner as MongoQueryRunner
            return mongoRunner
                .cursor(this.migrationsTableName, {})
                .sort({ _id: -1 })
                .toArray()
        } else {
            const migrationsRaw: ObjectLiteral[] = await this.connection.manager
                .createQueryBuilder(queryRunner)
                .select()
                .orderBy(this.connection.driver.escape("id"), "DESC")
                .from(this.migrationsTable, this.migrationsTableName)
                .getRawMany()
            return migrationsRaw.map((migrationRaw) => {
                return new Migration(
                    parseInt(migrationRaw["id"]),
                    parseInt(migrationRaw["timestamp"]),
                    migrationRaw["name"],
                )
            })
        }
    }

    /**
     * Gets all migrations that setup for this connection.
     */
    protected getMigrations(): Migration[] {
        const migrations = this.connection.migrations.map((migration) => {
            const migrationClassName =
                migration.name || (migration.constructor as any).name
            const migrationTimestamp = parseInt(
                migrationClassName.substr(-13),
                10,
            )
            if (!migrationTimestamp || isNaN(migrationTimestamp)) {
                throw new TypeORMError(
                    `${migrationClassName} migration name is wrong. Migration class name should have a JavaScript timestamp appended.`,
                )
            }

            return new Migration(
                undefined,
                migrationTimestamp,
                migrationClassName,
                migration,
            )
        })

        this.checkForDuplicateMigrations(migrations)

        // sort them by timestamp
        return migrations.sort((a, b) => a.timestamp - b.timestamp)
    }

    protected checkForDuplicateMigrations(migrations: Migration[]) {
        const migrationNames = migrations.map((migration) => migration.name)
        const duplicates = Array.from(
            new Set(
                migrationNames.filter(
                    (migrationName, index) =>
                        migrationNames.indexOf(migrationName) < index,
                ),
            ),
        )
        if (duplicates.length > 0) {
            throw Error(`Duplicate migrations: ${duplicates.join(", ")}`)
        }
    }

    /**
     * Finds the latest migration (sorts by timestamp) in the given array of migrations.
     */
    protected getLatestTimestampMigration(
        migrations: Migration[],
    ): Migration | undefined {
        const sortedMigrations = migrations
            .map((migration) => migration)
            .sort((a, b) => (a.timestamp - b.timestamp) * -1)
        return sortedMigrations.length > 0 ? sortedMigrations[0] : undefined
    }

    /**
     * Finds the latest migration in the given array of migrations.
     * PRE: Migration array must be sorted by descending id.
     */
    protected getLatestExecutedMigration(
        sortedMigrations: Migration[],
    ): Migration | undefined {
        return sortedMigrations.length > 0 ? sortedMigrations[0] : undefined
    }

    /**
     * Inserts new executed migration's data into migrations table.
     */
    protected async insertExecutedMigration(
        queryRunner: QueryRunner,
        migration: Migration,
    ): Promise<void> {
        const values: ObjectLiteral = {}
        if (this.connection.driver.options.type === "mssql") {
            values["timestamp"] = new MssqlParameter(
                migration.timestamp,
                this.connection.driver.normalizeType({
                    type: this.connection.driver.mappedDataTypes
                        .migrationTimestamp,
                }) as any,
            )
            values["name"] = new MssqlParameter(
                migration.name,
                this.connection.driver.normalizeType({
                    type: this.connection.driver.mappedDataTypes.migrationName,
                }) as any,
            )
        } else {
            values["timestamp"] = migration.timestamp
            values["name"] = migration.name
        }
        if (this.connection.driver.options.type === "mongodb") {
            const mongoRunner = queryRunner as MongoQueryRunner
            await mongoRunner.databaseConnection
                .db(this.connection.driver.database!)
                .collection(this.migrationsTableName)
                .insertOne(values)
        } else {
            const qb = queryRunner.manager.createQueryBuilder()
            await qb
                .insert()
                .into(this.migrationsTable)
                .values(values)
                .execute()
        }
    }

    /**
     * Delete previously executed migration's data from the migrations table.
     */
    protected async deleteExecutedMigration(
        queryRunner: QueryRunner,
        migration: Migration,
    ): Promise<void> {
        const conditions: ObjectLiteral = {}
        if (this.connection.driver.options.type === "mssql") {
            conditions["timestamp"] = new MssqlParameter(
                migration.timestamp,
                this.connection.driver.normalizeType({
                    type: this.connection.driver.mappedDataTypes
                        .migrationTimestamp,
                }) as any,
            )
            conditions["name"] = new MssqlParameter(
                migration.name,
                this.connection.driver.normalizeType({
                    type: this.connection.driver.mappedDataTypes.migrationName,
                }) as any,
            )
        } else {
            conditions["timestamp"] = migration.timestamp
            conditions["name"] = migration.name
        }

        if (this.connection.driver.options.type === "mongodb") {
            const mongoRunner = queryRunner as MongoQueryRunner
            await mongoRunner.databaseConnection
                .db(this.connection.driver.database!)
                .collection(this.migrationsTableName)
                .deleteOne(conditions)
        } else {
            const qb = queryRunner.manager.createQueryBuilder()
            await qb
                .delete()
                .from(this.migrationsTable)
                .where(`${qb.escape("timestamp")} = :timestamp`)
                .andWhere(`${qb.escape("name")} = :name`)
                .setParameters(conditions)
                .execute()
        }
    }

    protected async withQueryRunner<T extends any>(
        callback: (queryRunner: QueryRunner) => T | Promise<T>,
    ) {
        const queryRunner =
            this.queryRunner || this.connection.createQueryRunner()

        try {
            return await callback(queryRunner)
        } finally {
            if (!this.queryRunner) {
                await queryRunner.release()
            }
        }
    }
}
