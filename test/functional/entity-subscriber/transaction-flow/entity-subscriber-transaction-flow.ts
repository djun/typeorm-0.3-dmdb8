import {
    DataSource,
    EntitySubscriberInterface,
    EventSubscriber,
} from "../../../../src"
import {
    closeTestingConnections,
    createTestingConnections,
} from "../../../utils/test-utils"
import { Example } from "../query-data/entity/Example"
import sinon from "sinon"
import { expect } from "chai"

describe("entity subscriber > transaction flow", () => {
    let beforeTransactionStart = sinon.spy()
    let afterTransactionStart = sinon.spy()
    let afterInsert = sinon.spy()
    let beforeTransactionCommit = sinon.spy()
    let afterTransactionCommit = sinon.spy()
    let beforeTransactionRollback = sinon.spy()
    let afterTransactionRollback = sinon.spy()
    let afterInsertQueryRunnerData: any = undefined

    @EventSubscriber()
    class PostSubscriber implements EntitySubscriberInterface {
        beforeTransactionStart() {
            if (beforeTransactionStart) beforeTransactionStart(arguments)
        }

        afterTransactionStart() {
            if (afterTransactionStart) afterTransactionStart(arguments)
        }

        afterInsert() {
            afterInsertQueryRunnerData = arguments[0].queryRunner.data
            if (afterInsert) afterInsert(arguments)
        }

        beforeTransactionCommit() {
            if (beforeTransactionCommit) beforeTransactionCommit(arguments)
        }

        afterTransactionCommit() {
            if (afterTransactionCommit) afterTransactionCommit(arguments)
        }

        beforeTransactionRollback() {
            if (beforeTransactionRollback) beforeTransactionRollback(arguments)
        }

        afterTransactionRollback() {
            if (afterTransactionRollback) afterTransactionRollback(arguments)
        }
    }

    let connections: DataSource[]
    before(
        async () =>
            (connections = await createTestingConnections({
                entities: [Example],
                subscribers: [PostSubscriber],
                dropSchema: true,
                schemaCreate: true,
            })),
    )
    after(() => closeTestingConnections(connections))

    it("transactionStart", async () => {
        for (let connection of connections) {
            if (
                connection.driver.options.type === "mssql" ||
                connection.driver.options.type === "spanner"
            ) {
                continue
            }

            beforeTransactionStart.resetHistory()
            afterTransactionStart.resetHistory()

            let isolationLevel: any = undefined
            if (
                connection.driver.options.type === "sap" ||
                connection.driver.options.type === "oracle"
            ) {
                isolationLevel = "READ COMMITTED"
            }

            const queryRunner = connection.createQueryRunner()

            if (
                connection.driver.options.type === "aurora-postgres" ||
                connection.driver.options.type === "aurora-mysql"
            ) {
                const startTransactionFn = sinon.spy(
                    queryRunner.startTransaction,
                )
                await queryRunner.startTransaction()

                expect(beforeTransactionStart.calledBefore(startTransactionFn))
                    .to.be.true
                expect(afterTransactionStart.calledAfter(startTransactionFn)).to
                    .be.true

                startTransactionFn.restore()
                await queryRunner.commitTransaction()
            } else {
                const startTransactionFn = sinon.spy(queryRunner, "query")

                const queryCallBeforeTransactionStart = startTransactionFn
                    .getCalls()
                    .find((call) => {
                        return (
                            call.args[0] === "BEGIN TRANSACTION" ||
                            call.args[0] === "START TRANSACTION" ||
                            call.args[0] ===
                                "SET TRANSACTION ISOLATION LEVEL READ COMMITTED"
                        )
                    })
                expect(queryCallBeforeTransactionStart).to.be.undefined

                await queryRunner.startTransaction(isolationLevel)

                const queryCallAfterTransactionStart = startTransactionFn
                    .getCalls()
                    .find((call) => {
                        return (
                            call.args[0] === "BEGIN TRANSACTION" ||
                            call.args[0] === "START TRANSACTION" ||
                            call.args[0] ===
                                "SET TRANSACTION ISOLATION LEVEL READ COMMITTED"
                        )
                    })
                expect(beforeTransactionStart.called).to.be.true
                expect(afterTransactionStart.called).to.be.true
                expect(queryCallAfterTransactionStart).to.be.not.undefined
                expect(
                    beforeTransactionStart
                        .getCall(0)
                        .calledBefore(queryCallAfterTransactionStart!),
                ).to.be.true
                expect(
                    afterTransactionStart
                        .getCall(0)
                        .calledAfter(queryCallAfterTransactionStart!),
                ).to.be.true

                await queryRunner.commitTransaction()
                startTransactionFn.restore()
            }

            await queryRunner.release()
        }
    })

    it("transactionCommit", async () => {
        for (let connection of connections) {
            if (
                connection.driver.options.type === "mssql" ||
                connection.driver.options.type === "spanner"
            ) {
                continue
            }

            beforeTransactionCommit.resetHistory()
            afterTransactionCommit.resetHistory()

            const queryRunner = connection.createQueryRunner()
            await queryRunner.startTransaction()

            if (
                connection.driver.options.type === "aurora-postgres" ||
                connection.driver.options.type === "aurora-mysql"
            ) {
                const commitTransactionFn = sinon.spy(
                    queryRunner.commitTransaction,
                )
                await queryRunner.commitTransaction()

                expect(
                    beforeTransactionCommit.calledBefore(commitTransactionFn),
                ).to.be.true
                expect(afterTransactionCommit.calledAfter(commitTransactionFn))
                    .to.be.true

                commitTransactionFn.restore()
            } else {
                const commitTransactionFn = sinon.spy(queryRunner, "query")

                const queryCallBeforeTransactionCommit = commitTransactionFn
                    .getCalls()
                    .find((call) => {
                        return call.args[0] === "COMMIT"
                    })
                expect(queryCallBeforeTransactionCommit).to.be.undefined

                await queryRunner.commitTransaction()

                const queryCallAfterTransactionCommit = commitTransactionFn
                    .getCalls()
                    .find((call) => {
                        return call.args[0] === "COMMIT"
                    })
                expect(queryCallAfterTransactionCommit).to.be.not.undefined
                expect(beforeTransactionCommit.called).to.be.true
                expect(afterTransactionCommit.called).to.be.true
                expect(
                    beforeTransactionCommit
                        .getCall(0)
                        .calledBefore(queryCallAfterTransactionCommit!),
                ).to.be.true
                expect(
                    afterTransactionCommit
                        .getCall(0)
                        .calledAfter(queryCallAfterTransactionCommit!),
                ).to.be.true

                commitTransactionFn.restore()
            }

            await queryRunner.release()
        }
    })

    it("transactionRollback", async () => {
        for (let connection of connections) {
            if (
                connection.driver.options.type === "mssql" ||
                connection.driver.options.type === "spanner"
            ) {
                continue
            }

            beforeTransactionRollback.resetHistory()
            afterTransactionRollback.resetHistory()

            const queryRunner = connection.createQueryRunner()
            await queryRunner.startTransaction()

            if (
                connection.driver.options.type === "aurora-postgres" ||
                connection.driver.options.type === "aurora-mysql"
            ) {
                const rollbackTransactionFn = sinon.spy(
                    queryRunner.rollbackTransaction,
                )
                await queryRunner.rollbackTransaction()

                expect(
                    beforeTransactionRollback.calledBefore(
                        rollbackTransactionFn,
                    ),
                ).to.be.true
                expect(
                    afterTransactionRollback.calledAfter(rollbackTransactionFn),
                ).to.be.true

                rollbackTransactionFn.restore()
            } else {
                const rollbackTransactionFn = sinon.spy(queryRunner, "query")

                const queryCallBeforeTransactionRollback = rollbackTransactionFn
                    .getCalls()
                    .find((call) => {
                        return call.args[0] === "ROLLBACK"
                    })
                expect(queryCallBeforeTransactionRollback).to.be.undefined

                await queryRunner.rollbackTransaction()

                const queryCallAfterTransactionRollback = rollbackTransactionFn
                    .getCalls()
                    .find((call) => {
                        return call.args[0] === "ROLLBACK"
                    })
                expect(queryCallAfterTransactionRollback).to.be.not.undefined
                expect(beforeTransactionRollback.called).to.be.true
                expect(afterTransactionRollback.called).to.be.true
                expect(
                    beforeTransactionRollback
                        .getCall(0)
                        .calledBefore(queryCallAfterTransactionRollback!),
                ).to.be.true
                expect(
                    afterTransactionRollback
                        .getCall(0)
                        .calledAfter(queryCallAfterTransactionRollback!),
                ).to.be.true

                rollbackTransactionFn.restore()
            }

            await queryRunner.release()
        }
    })

    it("query data in subscribers", async () => {
        const example = new Example()
        const data = { hello: ["world"] }

        for (let connection of connections) {
            beforeTransactionCommit.resetHistory()
            afterTransactionCommit.resetHistory()
            afterInsert.resetHistory()

            afterInsertQueryRunnerData = undefined
            const queryRunner = connection.createQueryRunner()
            await queryRunner.startTransaction()

            await queryRunner.manager.save(example, { data })

            await queryRunner.commitTransaction()

            expect(afterInsertQueryRunnerData).to.eql(data)

            afterInsertQueryRunnerData = undefined
            await queryRunner.release()
        }
    })
})
