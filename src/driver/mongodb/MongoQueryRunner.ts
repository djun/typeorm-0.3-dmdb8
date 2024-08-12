import { QueryRunner } from "../../query-runner/QueryRunner"
import { TableColumn } from "../../schema-builder/table/TableColumn"
import { Table } from "../../schema-builder/table/Table"
import { TableForeignKey } from "../../schema-builder/table/TableForeignKey"
import { TableIndex } from "../../schema-builder/table/TableIndex"
import { View } from "../../schema-builder/view/View"
// import {Connection} from "../../connection/Connection";
import { ReadStream } from "../../platform/PlatformTools"
import { MongoEntityManager } from "../../entity-manager/MongoEntityManager"
import { SqlInMemory } from "../SqlInMemory"
import { TableUnique } from "../../schema-builder/table/TableUnique"
import { Broadcaster } from "../../subscriber/Broadcaster"
import { TableCheck } from "../../schema-builder/table/TableCheck"
import { TableExclusion } from "../../schema-builder/table/TableExclusion"
import { TypeORMError } from "../../error"

import {
    BulkWriteResult,
    AggregationCursor,
    MongoClient,
    Collection,
    FindCursor,
    Document,
    AggregateOptions,
    AnyBulkWriteOperation,
    BulkWriteOptions,
    Filter,
    CountOptions,
    CountDocumentsOptions,
    IndexSpecification,
    CreateIndexesOptions,
    IndexDescription,
    DeleteResult,
    DeleteOptions,
    CommandOperationOptions,
    FindOneAndDeleteOptions,
    FindOneAndReplaceOptions,
    UpdateFilter,
    FindOneAndUpdateOptions,
    RenameOptions,
    ReplaceOptions,
    UpdateResult,
    CollStats,
    CollStatsOptions,
    ChangeStreamOptions,
    ChangeStream,
    UpdateOptions,
    ListIndexesOptions,
    ListIndexesCursor,
    OptionalId,
    InsertOneOptions,
    InsertOneResult,
    InsertManyResult,
    UnorderedBulkOperation,
    OrderedBulkOperation,
    IndexInformationOptions,
} from "../../driver/mongodb/typings"
import { DataSource } from "../../data-source/DataSource"
import { ReplicationMode } from "../types/ReplicationMode"

/**
 * Runs queries on a single MongoDB connection.
 */
export class MongoQueryRunner implements QueryRunner {
    // -------------------------------------------------------------------------
    // Public Implemented Properties
    // -------------------------------------------------------------------------

    /**
     * Connection used by this query runner.
     */
    connection: DataSource

    /**
     * Broadcaster used on this query runner to broadcast entity events.
     */
    broadcaster: Broadcaster

    /**
     * Entity manager working only with current query runner.
     */
    manager: MongoEntityManager

    /**
     * Indicates if connection for this query runner is released.
     * Once its released, query runner cannot run queries anymore.
     * Always false for mongodb since mongodb has a single query executor instance.
     */
    isReleased = false

    /**
     * Indicates if transaction is active in this query executor.
     * Always false for mongodb since mongodb does not support transactions.
     */
    isTransactionActive = false

    /**
     * Stores temporarily user data.
     * Useful for sharing data with subscribers.
     */
    data = {}

    /**
     * All synchronized tables in the database.
     */
    loadedTables: Table[]

    /**
     * All synchronized views in the database.
     */
    loadedViews: View[]

    /**
     * Real database connection from a connection pool used to perform queries.
     */
    databaseConnection: MongoClient

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(connection: DataSource, databaseConnection: MongoClient) {
        this.connection = connection
        this.databaseConnection = databaseConnection
        this.broadcaster = new Broadcaster(this)
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Called before migrations are run.
     */
    async beforeMigration(): Promise<void> {
        // Do nothing
    }

    /**
     * Called after migrations are run.
     */
    async afterMigration(): Promise<void> {
        // Do nothing
    }

    /**
     * Creates a cursor for a query that can be used to iterate over results from MongoDB.
     */
    cursor(collectionName: string, filter: Filter<Document>): FindCursor<any> {
        return this.getCollection(collectionName).find(filter || {})
    }

    /**
     * Execute an aggregation framework pipeline against the collection.
     */
    aggregate(
        collectionName: string,
        pipeline: Document[],
        options?: AggregateOptions,
    ): AggregationCursor<any> {
        return this.getCollection(collectionName).aggregate(
            pipeline,
            options || {},
        )
    }

    /**
     * Perform a bulkWrite operation without a fluent API.
     */
    async bulkWrite(
        collectionName: string,
        operations: AnyBulkWriteOperation<Document>[],
        options?: BulkWriteOptions,
    ): Promise<BulkWriteResult> {
        return await this.getCollection(collectionName).bulkWrite(
            operations,
            options || {},
        )
    }

    /**
     * Count number of matching documents in the db to a query.
     */
    async count(
        collectionName: string,
        filter: Filter<Document>,
        options?: CountOptions,
    ): Promise<number> {
        return this.getCollection(collectionName).count(
            filter || {},
            options || {},
        )
    }

    /**
     * Count number of matching documents in the db to a query.
     */
    async countDocuments(
        collectionName: string,
        filter: Filter<Document>,
        options?: CountDocumentsOptions,
    ): Promise<any> {
        return this.getCollection(collectionName).countDocuments(
            filter || {},
            options || {},
        )
    }

    /**
     * Creates an index on the db and collection.
     */
    async createCollectionIndex(
        collectionName: string,
        indexSpec: IndexSpecification,
        options?: CreateIndexesOptions,
    ): Promise<string> {
        return this.getCollection(collectionName).createIndex(
            indexSpec,
            options || {},
        )
    }

    /**
     * Creates multiple indexes in the collection, this method is only supported for MongoDB 2.6 or higher.
     * Earlier version of MongoDB will throw a command not supported error. Index specifications are defined at http://docs.mongodb.org/manual/reference/command/createIndexes/.
     */
    async createCollectionIndexes(
        collectionName: string,
        indexSpecs: IndexDescription[],
    ): Promise<string[]> {
        return this.getCollection(collectionName).createIndexes(indexSpecs)
    }

    /**
     * Delete multiple documents on MongoDB.
     */
    async deleteMany(
        collectionName: string,
        filter: Filter<Document>,
        options: DeleteOptions,
    ): Promise<DeleteResult> {
        return this.getCollection(collectionName).deleteMany(
            filter,
            options || {},
        )
    }

    /**
     * Delete a document on MongoDB.
     */
    async deleteOne(
        collectionName: string,
        filter: Filter<Document>,
        options?: DeleteOptions,
    ): Promise<DeleteResult> {
        return this.getCollection(collectionName).deleteOne(
            filter,
            options || {},
        )
    }

    /**
     * The distinct command returns returns a list of distinct values for the given key across a collection.
     */
    async distinct(
        collectionName: string,
        key: any,
        filter: Filter<Document>,
        options?: CommandOperationOptions,
    ): Promise<any> {
        return this.getCollection(collectionName).distinct(
            key,
            filter,
            options || {},
        )
    }

    /**
     * Drops an index from this collection.
     */
    async dropCollectionIndex(
        collectionName: string,
        indexName: string,
        options?: CommandOperationOptions,
    ): Promise<Document> {
        return this.getCollection(collectionName).dropIndex(
            indexName,
            options || {},
        )
    }

    /**
     * Drops all indexes from the collection.
     */
    async dropCollectionIndexes(collectionName: string): Promise<Document> {
        return this.getCollection(collectionName).dropIndexes()
    }

    /**
     * Find a document and delete it in one atomic operation, requires a write lock for the duration of the operation.
     */
    async findOneAndDelete(
        collectionName: string,
        filter: Filter<Document>,
        options?: FindOneAndDeleteOptions,
    ): Promise<Document | null> {
        return this.getCollection(collectionName).findOneAndDelete(
            filter,
            options || {},
        )
    }

    /**
     * Find a document and replace it in one atomic operation, requires a write lock for the duration of the operation.
     */
    async findOneAndReplace(
        collectionName: string,
        filter: Filter<Document>,
        replacement: Document,
        options?: FindOneAndReplaceOptions,
    ): Promise<Document | null> {
        return this.getCollection(collectionName).findOneAndReplace(
            filter,
            replacement,
            options || {},
        )
    }

    /**
     * Find a document and update it in one atomic operation, requires a write lock for the duration of the operation.
     */
    async findOneAndUpdate(
        collectionName: string,
        filter: Filter<Document>,
        update: UpdateFilter<Document>,
        options?: FindOneAndUpdateOptions,
    ): Promise<Document | null> {
        return this.getCollection(collectionName).findOneAndUpdate(
            filter,
            update,
            options || {},
        )
    }

    /**
     * Retrieve all the indexes on the collection.
     */
    async collectionIndexes(collectionName: string): Promise<Document> {
        return this.getCollection(collectionName).indexes()
    }

    /**
     * Retrieve all the indexes on the collection.
     */
    async collectionIndexExists(
        collectionName: string,
        indexes: string | string[],
    ): Promise<boolean> {
        return this.getCollection(collectionName).indexExists(indexes)
    }

    /**
     * Retrieves this collections index info.
     */
    async collectionIndexInformation(
        collectionName: string,
        options?: IndexInformationOptions,
    ): Promise<any> {
        return this.getCollection(collectionName).indexInformation(
            options || {},
        )
    }

    /**
     * Initiate an In order bulk write operation, operations will be serially executed in the order they are added, creating a new operation for each switch in types.
     */
    initializeOrderedBulkOp(
        collectionName: string,
        options?: BulkWriteOptions,
    ): OrderedBulkOperation {
        return this.getCollection(collectionName).initializeOrderedBulkOp(
            options,
        )
    }

    /**
     * Initiate a Out of order batch write operation. All operations will be buffered into insert/update/remove commands executed out of order.
     */
    initializeUnorderedBulkOp(
        collectionName: string,
        options?: BulkWriteOptions,
    ): UnorderedBulkOperation {
        return this.getCollection(collectionName).initializeUnorderedBulkOp(
            options,
        )
    }

    /**
     * Inserts an array of documents into MongoDB.
     */
    async insertMany(
        collectionName: string,
        docs: OptionalId<Document>[],
        options?: BulkWriteOptions,
    ): Promise<InsertManyResult> {
        return this.getCollection(collectionName).insertMany(
            docs,
            options || {},
        )
    }

    /**
     * Inserts a single document into MongoDB.
     */
    async insertOne(
        collectionName: string,
        doc: OptionalId<Document>,
        options?: InsertOneOptions,
    ): Promise<InsertOneResult> {
        return this.getCollection(collectionName).insertOne(doc, options || {})
    }

    /**
     * Returns if the collection is a capped collection.
     */
    async isCapped(collectionName: string): Promise<boolean> {
        return this.getCollection(collectionName).isCapped()
    }

    /**
     * Get the list of all indexes information for the collection.
     */
    listCollectionIndexes(
        collectionName: string,
        options?: ListIndexesOptions,
    ): ListIndexesCursor {
        return this.getCollection(collectionName).listIndexes(options)
    }

    /**
     * Reindex all indexes on the collection Warning: reIndex is a blocking operation (indexes are rebuilt in the foreground) and will be slow for large collections.
     */
    async rename(
        collectionName: string,
        newName: string,
        options?: RenameOptions,
    ): Promise<Collection<Document>> {
        return this.getCollection(collectionName).rename(newName, options || {})
    }

    /**
     * Replace a document on MongoDB.
     */
    async replaceOne(
        collectionName: string,
        filter: Filter<Document>,
        replacement: Document,
        options?: ReplaceOptions,
    ): Promise<Document | UpdateResult> {
        return this.getCollection(collectionName).replaceOne(
            filter,
            replacement,
            options || {},
        )
    }

    /**
     * Get all the collection statistics.
     */
    async stats(
        collectionName: string,
        options?: CollStatsOptions,
    ): Promise<CollStats> {
        return this.getCollection(collectionName).stats(options || {})
    }

    /**
     * Watching new changes as stream.
     */
    watch(
        collectionName: string,
        pipeline?: Document[],
        options?: ChangeStreamOptions,
    ): ChangeStream {
        return this.getCollection(collectionName).watch(pipeline, options)
    }

    /**
     * Update multiple documents on MongoDB.
     */
    async updateMany(
        collectionName: string,
        filter: Filter<Document>,
        update: UpdateFilter<Document>,
        options?: UpdateOptions,
    ): Promise<Document | UpdateResult> {
        return this.getCollection(collectionName).updateMany(
            filter,
            update,
            options || {},
        )
    }

    /**
     * Update a single document on MongoDB.
     */
    async updateOne(
        collectionName: string,
        filter: Filter<Document>,
        update: UpdateFilter<Document>,
        options?: UpdateOptions,
    ): Promise<Document | UpdateResult> {
        return await this.getCollection(collectionName).updateOne(
            filter,
            update,
            options || {},
        )
    }

    // -------------------------------------------------------------------------
    // Public Implemented Methods (from QueryRunner)
    // -------------------------------------------------------------------------

    /**
     * Removes all collections from the currently connected database.
     * Be careful with using this method and avoid using it in production or migrations
     * (because it can clear all your database).
     */
    async clearDatabase(): Promise<void> {
        await this.databaseConnection
            .db(this.connection.driver.database!)
            .dropDatabase()
    }

    /**
     * For MongoDB database we don't create connection, because its single connection already created by a driver.
     */
    async connect(): Promise<any> {}

    /**
     * For MongoDB database we don't release connection, because its single connection.
     */
    async release(): Promise<void> {
        // releasing connection are not supported by mongodb driver, so simply don't do anything here
    }

    /**
     * Starts transaction.
     */
    async startTransaction(): Promise<void> {
        // transactions are not supported by mongodb driver, so simply don't do anything here
    }

    /**
     * Commits transaction.
     */
    async commitTransaction(): Promise<void> {
        // transactions are not supported by mongodb driver, so simply don't do anything here
    }

    /**
     * Rollbacks transaction.
     */
    async rollbackTransaction(): Promise<void> {
        // transactions are not supported by mongodb driver, so simply don't do anything here
    }

    /**
     * Executes a given SQL query.
     */
    query(query: string, parameters?: any[]): Promise<any> {
        throw new TypeORMError(
            `Executing SQL query is not supported by MongoDB driver.`,
        )
    }

    /**
     * Returns raw data stream.
     */
    stream(
        query: string,
        parameters?: any[],
        onEnd?: Function,
        onError?: Function,
    ): Promise<ReadStream> {
        throw new TypeORMError(
            `Stream is not supported by MongoDB driver. Use watch instead.`,
        )
    }

    /**
     * Insert a new row with given values into the given table.
     * Returns value of inserted object id.

    async insert(collectionName: string, keyValues: ObjectLiteral): Promise<any> { // todo: fix any
        const results = await this.databaseConnection
            .collection(collectionName)
            .insertOne(keyValues);
        const generatedMap = this.connection.getMetadata(collectionName).objectIdColumn!.createValueMap(results.insertedId);
        return {
            result: results,
            generatedMap: generatedMap
        };
    }*/

    /**
     * Updates rows that match given conditions in the given table.

    async update(collectionName: string, valuesMap: ObjectLiteral, conditions: ObjectLiteral): Promise<any> { // todo: fix any
        await this.databaseConnection
            .collection(collectionName)
            .updateOne(conditions, valuesMap);
    }*/

    /**
     * Deletes from the given table by a given conditions.

    async delete(collectionName: string, conditions: ObjectLiteral|ObjectLiteral[]|string, maybeParameters?: any[]): Promise<any> { // todo: fix any
        if (typeof conditions === "string")
            throw new TypeORMError(`String condition is not supported by MongoDB driver.`);

        await this.databaseConnection
            .collection(collectionName)
            .deleteOne(conditions);
    }*/

    /**
     * Returns all available database names including system databases.
     */
    async getDatabases(): Promise<string[]> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Returns all available schema names including system schemas.
     * If database parameter specified, returns schemas of that database.
     */
    async getSchemas(database?: string): Promise<string[]> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Loads given table's data from the database.
     */
    async getTable(collectionName: string): Promise<Table | undefined> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Loads all tables (with given names) from the database and creates a Table from them.
     */
    async getTables(collectionNames: string[]): Promise<Table[]> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Loads given views's data from the database.
     */
    async getView(collectionName: string): Promise<View | undefined> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Loads all views (with given names) from the database and creates a Table from them.
     */
    async getViews(collectionNames: string[]): Promise<View[]> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    getReplicationMode(): ReplicationMode {
        return "master"
    }

    /**
     * Checks if database with the given name exist.
     */
    async hasDatabase(database: string): Promise<boolean> {
        throw new TypeORMError(
            `Check database queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Loads currently using database
     */
    async getCurrentDatabase(): Promise<undefined> {
        throw new TypeORMError(
            `Check database queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Checks if schema with the given name exist.
     */
    async hasSchema(schema: string): Promise<boolean> {
        throw new TypeORMError(
            `Check schema queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Loads currently using database schema
     */
    async getCurrentSchema(): Promise<undefined> {
        throw new TypeORMError(
            `Check schema queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Checks if table with the given name exist in the database.
     */
    async hasTable(collectionName: string): Promise<boolean> {
        throw new TypeORMError(
            `Check schema queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Checks if column with the given name exist in the given table.
     */
    async hasColumn(
        tableOrName: Table | string,
        columnName: string,
    ): Promise<boolean> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a database if it's not created.
     */
    async createDatabase(database: string): Promise<void> {
        throw new TypeORMError(
            `Database create queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops database.
     */
    async dropDatabase(database: string, ifExist?: boolean): Promise<void> {
        throw new TypeORMError(
            `Database drop queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new table schema.
     */
    async createSchema(
        schemaPath: string,
        ifNotExist?: boolean,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema create queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops table schema.
     */
    async dropSchema(schemaPath: string, ifExist?: boolean): Promise<void> {
        throw new TypeORMError(
            `Schema drop queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new table from the given table and columns inside it.
     */
    async createTable(table: Table): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops the table.
     */
    async dropTable(tableName: Table | string): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new view.
     */
    async createView(view: View): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops the view.
     */
    async dropView(target: View | string): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Renames the given table.
     */
    async renameTable(
        oldTableOrName: Table | string,
        newTableOrName: Table | string,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new column from the column in the table.
     */
    async addColumn(
        tableOrName: Table | string,
        column: TableColumn,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new columns from the column in the table.
     */
    async addColumns(
        tableOrName: Table | string,
        columns: TableColumn[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Renames column in the given table.
     */
    async renameColumn(
        tableOrName: Table | string,
        oldTableColumnOrName: TableColumn | string,
        newTableColumnOrName: TableColumn | string,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Changes a column in the table.
     */
    async changeColumn(
        tableOrName: Table | string,
        oldTableColumnOrName: TableColumn | string,
        newColumn: TableColumn,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Changes a column in the table.
     */
    async changeColumns(
        tableOrName: Table | string,
        changedColumns: { newColumn: TableColumn; oldColumn: TableColumn }[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops column in the table.
     */
    async dropColumn(
        tableOrName: Table | string,
        columnOrName: TableColumn | string,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops the columns in the table.
     */
    async dropColumns(
        tableOrName: Table | string,
        columns: TableColumn[] | string[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new primary key.
     */
    async createPrimaryKey(
        tableOrName: Table | string,
        columnNames: string[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Updates composite primary keys.
     */
    async updatePrimaryKeys(
        tableOrName: Table | string,
        columns: TableColumn[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops a primary key.
     */
    async dropPrimaryKey(tableOrName: Table | string): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new unique constraint.
     */
    async createUniqueConstraint(
        tableOrName: Table | string,
        uniqueConstraint: TableUnique,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new unique constraints.
     */
    async createUniqueConstraints(
        tableOrName: Table | string,
        uniqueConstraints: TableUnique[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops an unique constraint.
     */
    async dropUniqueConstraint(
        tableOrName: Table | string,
        uniqueOrName: TableUnique | string,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops an unique constraints.
     */
    async dropUniqueConstraints(
        tableOrName: Table | string,
        uniqueConstraints: TableUnique[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new check constraint.
     */
    async createCheckConstraint(
        tableOrName: Table | string,
        checkConstraint: TableCheck,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new check constraints.
     */
    async createCheckConstraints(
        tableOrName: Table | string,
        checkConstraints: TableCheck[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops check constraint.
     */
    async dropCheckConstraint(
        tableOrName: Table | string,
        checkOrName: TableCheck | string,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops check constraints.
     */
    async dropCheckConstraints(
        tableOrName: Table | string,
        checkConstraints: TableCheck[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new exclusion constraint.
     */
    async createExclusionConstraint(
        tableOrName: Table | string,
        exclusionConstraint: TableExclusion,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new exclusion constraints.
     */
    async createExclusionConstraints(
        tableOrName: Table | string,
        exclusionConstraints: TableExclusion[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops exclusion constraint.
     */
    async dropExclusionConstraint(
        tableOrName: Table | string,
        exclusionOrName: TableExclusion | string,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops exclusion constraints.
     */
    async dropExclusionConstraints(
        tableOrName: Table | string,
        exclusionConstraints: TableExclusion[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new foreign key.
     */
    async createForeignKey(
        tableOrName: Table | string,
        foreignKey: TableForeignKey,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new foreign keys.
     */
    async createForeignKeys(
        tableOrName: Table | string,
        foreignKeys: TableForeignKey[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops a foreign key from the table.
     */
    async dropForeignKey(
        tableOrName: Table | string,
        foreignKey: TableForeignKey,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops a foreign keys from the table.
     */
    async dropForeignKeys(
        tableOrName: Table | string,
        foreignKeys: TableForeignKey[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new index.
     */
    async createIndex(
        tableOrName: Table | string,
        index: TableIndex,
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Creates a new indices
     */
    async createIndices(
        tableOrName: Table | string,
        indices: TableIndex[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops an index from the table.
     */
    async dropIndex(collectionName: string, indexName: string): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops an indices from the table.
     */
    async dropIndices(
        tableOrName: Table | string,
        indices: TableIndex[],
    ): Promise<void> {
        throw new TypeORMError(
            `Schema update queries are not supported by MongoDB driver.`,
        )
    }

    /**
     * Drops collection.
     */
    async clearTable(collectionName: string): Promise<void> {
        await this.databaseConnection
            .db(this.connection.driver.database!)
            .dropCollection(collectionName)
    }

    /**
     * Enables special query runner mode in which sql queries won't be executed,
     * instead they will be memorized into a special variable inside query runner.
     * You can get memorized sql using getMemorySql() method.
     */
    enableSqlMemory(): void {
        throw new TypeORMError(
            `This operation is not supported by MongoDB driver.`,
        )
    }

    /**
     * Disables special query runner mode in which sql queries won't be executed
     * started by calling enableSqlMemory() method.
     *
     * Previously memorized sql will be flushed.
     */
    disableSqlMemory(): void {
        throw new TypeORMError(
            `This operation is not supported by MongoDB driver.`,
        )
    }

    /**
     * Flushes all memorized sqls.
     */
    clearSqlMemory(): void {
        throw new TypeORMError(
            `This operation is not supported by MongoDB driver.`,
        )
    }

    /**
     * Gets sql stored in the memory. Parameters in the sql are already replaced.
     */
    getMemorySql(): SqlInMemory {
        throw new TypeORMError(
            `This operation is not supported by MongoDB driver.`,
        )
    }

    /**
     * Executes up sql queries.
     */
    async executeMemoryUpSql(): Promise<void> {
        throw new TypeORMError(
            `This operation is not supported by MongoDB driver.`,
        )
    }

    /**
     * Executes down sql queries.
     */
    async executeMemoryDownSql(): Promise<void> {
        throw new TypeORMError(
            `This operation is not supported by MongoDB driver.`,
        )
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    /**
     * Gets collection from the database with a given name.
     */
    protected getCollection(collectionName: string): Collection<any> {
        return this.databaseConnection
            .db(this.connection.driver.database!)
            .collection(collectionName)
    }

    /**
     * Change table comment.
     */
    changeTableComment(
        tableOrName: Table | string,
        comment?: string,
    ): Promise<void> {
        throw new TypeORMError(
            `mongodb driver does not support change table comment.`,
        )
    }
}
