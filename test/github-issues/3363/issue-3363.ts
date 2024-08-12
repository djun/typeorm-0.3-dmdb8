import "reflect-metadata"
import {
    closeTestingConnections,
    createTestingConnections,
    reloadTestingDatabases,
} from "../../utils/test-utils"
import { DataSource } from "../../../src/data-source/DataSource"
import { Post } from "./entity/Post"
import { expect } from "chai"
import { Category } from "./entity/Category"

describe("github issues > #3363 Isolation Level in transaction() from Connection", () => {
    let connections: DataSource[]
    before(
        async () =>
            (connections = await createTestingConnections({
                entities: [__dirname + "/entity/*{.js,.ts}"],
                subscribers: [__dirname + "/subscriber/*{.js,.ts}"],
            })),
    )
    beforeEach(() => reloadTestingDatabases(connections))
    after(() => closeTestingConnections(connections))

    it("should execute operations in READ UNCOMMITED isolation level", () =>
        Promise.all(
            connections.map(async function (connection) {
                // SAP, Oracle does not support READ UNCOMMITTED isolation level
                if (
                    connection.driver.options.type === "sap" ||
                    connection.driver.options.type === "oracle"
                )
                    return

                let postId: number | undefined = undefined,
                    categoryId: number | undefined = undefined

                await connection.transaction(
                    "READ UNCOMMITTED",
                    async (transaction) => {
                        const post = new Post()
                        post.title = "Post #1"
                        await transaction.save(post)

                        const category = new Category()
                        category.name = "Category #1"
                        await transaction.save(category)

                        postId = post.id
                        categoryId = category.id
                    },
                )

                const post = await connection.manager.findOne(Post, {
                    where: { title: "Post #1" },
                })
                expect(post).not.to.be.null
                post!.should.be.eql({
                    id: postId,
                    title: "Post #1",
                })

                const category = await connection.manager.findOne(Category, {
                    where: { name: "Category #1" },
                })
                expect(category).not.to.be.null
                category!.should.be.eql({
                    id: categoryId,
                    name: "Category #1",
                })
            }),
        ))

    it("should execute operations in SERIALIZABLE isolation level", () =>
        Promise.all(
            connections.map(async (connection) => {
                let postId: number | undefined = undefined,
                    categoryId: number | undefined = undefined

                // Initial inserts are required to prevent ORA-08177 errors in Oracle 21c when using a serializable connection
                // immediately after DDL statements. This ensures proper synchronization and helps avoid conflicts.
                await connection.manager
                    .getRepository(Post)
                    .save({ title: "Post #0" })
                await connection.manager
                    .getRepository(Category)
                    .save({ name: "Category #0" })

                await connection.transaction(
                    "SERIALIZABLE",
                    async (entityManager) => {
                        const post = new Post()
                        post.title = "Post #1"
                        await entityManager.save(post)

                        const category = new Category()
                        category.name = "Category #1"
                        await entityManager.save(category)

                        postId = post.id
                        categoryId = category.id
                    },
                )

                const post = await connection.manager.findOne(Post, {
                    where: { title: "Post #1" },
                })
                expect(post).not.to.be.null
                post!.should.be.eql({
                    id: postId,
                    title: "Post #1",
                })

                const category = await connection.manager.findOne(Category, {
                    where: { name: "Category #1" },
                })
                expect(category).not.to.be.null
                category!.should.be.eql({
                    id: categoryId,
                    name: "Category #1",
                })
            }),
        ))
})
