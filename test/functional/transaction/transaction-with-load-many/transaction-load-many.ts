import "reflect-metadata"
import { expect } from "chai"
import {
    closeTestingConnections,
    createTestingConnections,
    reloadTestingDatabases,
} from "../../../utils/test-utils"
import { DataSource } from "../../../../src"
import { Post } from "./entity/Post"
import { MysqlDriver } from "../../../../src/driver/mysql/MysqlDriver"
import { PostgresDriver } from "../../../../src/driver/postgres/PostgresDriver"
import { DriverUtils } from "../../../../src/driver/DriverUtils"

describe("transaction > transaction with load many", () => {
    let connections: DataSource[]
    before(
        async () =>
            (connections = await createTestingConnections({
                entities: [__dirname + "/entity/*{.js,.ts}"],
                enabledDrivers: ["postgres", "mariadb", "mysql"],
            })),
    )
    beforeEach(() => reloadTestingDatabases(connections))
    after(() => closeTestingConnections(connections))

    it("should loadMany in same transaction with same query runner", () =>
        Promise.all(
            connections.map(async (connection) => {
                let acquireCount = 0

                const driver = connection.driver

                if (DriverUtils.isMySQLFamily(driver)) {
                    const pool = (driver as MysqlDriver).pool
                    pool.on("acquire", () => acquireCount++)
                } else if (driver.options.type === "postgres") {
                    const pool = (driver as PostgresDriver).master
                    pool.on("acquire", () => acquireCount++)
                }

                await connection.manager.transaction(async (entityManager) => {
                    await entityManager
                        .createQueryBuilder()
                        .relation(Post, "categories")
                        .of(1)
                        .loadMany()

                    expect(acquireCount).to.be.eq(1)
                })
            }),
        ))
})
