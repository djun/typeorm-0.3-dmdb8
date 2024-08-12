import "reflect-metadata"
import { expect } from "chai"
import { DataSource } from "../../src/data-source/DataSource"
import { Repository } from "../../src/repository/Repository"
import { PostDetails } from "../../sample/sample4-many-to-many/entity/PostDetails"
import { Post } from "../../sample/sample4-many-to-many/entity/Post"
import { PostCategory } from "../../sample/sample4-many-to-many/entity/PostCategory"
import { PostMetadata } from "../../sample/sample4-many-to-many/entity/PostMetadata"
import { PostImage } from "../../sample/sample4-many-to-many/entity/PostImage"
import { setupSingleTestingConnection } from "../utils/test-utils"

describe("many-to-many", function () {
    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------

    // connect to db
    let dataSource: DataSource
    before(async function () {
        const options = setupSingleTestingConnection("mysql", {
            entities: [
                __dirname + "/../../sample/sample4-many-to-many/entity/*",
            ],
        })

        if (!options) return
        dataSource = new DataSource(options)
        await dataSource.initialize()
    })

    after(() => dataSource.destroy())

    // clean up database before each test
    function reloadDatabase() {
        if (!dataSource) return
        return dataSource.synchronize(true)
    }

    let postRepository: Repository<Post>,
        postDetailsRepository: Repository<PostDetails>,
        postCategoryRepository: Repository<PostCategory>,
        postImageRepository: Repository<PostImage>,
        postMetadataRepository: Repository<PostMetadata>
    before(function () {
        if (!dataSource) return
        postRepository = dataSource.getRepository(Post)
        postDetailsRepository = dataSource.getRepository(PostDetails)
        postCategoryRepository = dataSource.getRepository(PostCategory)
        postImageRepository = dataSource.getRepository(PostImage)
        postMetadataRepository = dataSource.getRepository(PostMetadata)
    })

    // -------------------------------------------------------------------------
    // Specifications
    // -------------------------------------------------------------------------

    describe("insert post and details (has inverse relation + full cascade options)", function () {
        if (!dataSource) return
        let newPost: Post, details: PostDetails, savedPost: Post

        before(reloadDatabase)

        before(function () {
            details = new PostDetails()
            details.authorName = "Umed"
            details.comment = "this is post"
            details.metadata = "post,posting,postman"

            newPost = new Post()
            newPost.text = "Hello post"
            newPost.title = "this is post title"
            newPost.details = []
            newPost.details.push(details)

            return postRepository
                .save(newPost)
                .then((post) => (savedPost = post as Post))
        })

        it("should return the same post instance after its created", function () {
            savedPost.should.be.equal(newPost)
        })

        it("should return the same post details instance after its created", function () {
            savedPost.details[0].should.be.equal(newPost.details[0])
        })

        it("should have a new generated id after post is created", function () {
            expect(savedPost.id).not.to.be.undefined
            expect(savedPost.details[0].id).not.to.be.undefined
        })

        it("should have inserted post in the database", function () {
            const expectedPost = new Post()
            expectedPost.id = savedPost.id
            expectedPost.text = savedPost.text
            expectedPost.title = savedPost.title

            return postRepository
                .findOneBy({
                    id: savedPost.id,
                })
                .should.eventually.eql(expectedPost)
        })

        it("should have inserted post details in the database", function () {
            const expectedDetails = new PostDetails()
            expectedDetails.id = savedPost.details[0].id
            expectedDetails.authorName = savedPost.details[0].authorName
            expectedDetails.comment = savedPost.details[0].comment
            expectedDetails.metadata = savedPost.details[0].metadata

            return postDetailsRepository
                .findOneBy({
                    id: savedPost.details[0].id,
                })
                .should.eventually.eql(expectedDetails)
        })

        it("should load post and its details if left join used", function () {
            const expectedPost = new Post()
            expectedPost.id = savedPost.id
            expectedPost.text = savedPost.text
            expectedPost.title = savedPost.title
            expectedPost.details = []
            expectedPost.details.push(new PostDetails())
            expectedPost.details[0].id = savedPost.details[0].id
            expectedPost.details[0].authorName = savedPost.details[0].authorName
            expectedPost.details[0].comment = savedPost.details[0].comment
            expectedPost.details[0].metadata = savedPost.details[0].metadata

            return postRepository
                .createQueryBuilder("post")
                .leftJoinAndSelect("post.details", "details")
                .where("post.id=:id")
                .setParameter("id", savedPost.id)
                .getOne()
                .should.eventually.eql(expectedPost)
        })

        it("should load details and its post if left join used (from reverse side)", function () {
            const expectedDetails = new PostDetails()
            expectedDetails.id = savedPost.details[0].id
            expectedDetails.authorName = savedPost.details[0].authorName
            expectedDetails.comment = savedPost.details[0].comment
            expectedDetails.metadata = savedPost.details[0].metadata

            const expectedPost = new Post()
            expectedPost.id = savedPost.id
            expectedPost.text = savedPost.text
            expectedPost.title = savedPost.title

            expectedDetails.posts = []
            expectedDetails.posts.push(expectedPost)

            return postDetailsRepository
                .createQueryBuilder("details")
                .leftJoinAndSelect("details.posts", "posts")
                .where("details.id=:id")
                .setParameter("id", savedPost.id)
                .getOne()
                .should.eventually.eql(expectedDetails)
        })

        it("should load saved post without details if left joins are not specified", function () {
            const expectedPost = new Post()
            expectedPost.id = savedPost.id
            expectedPost.text = savedPost.text
            expectedPost.title = savedPost.title

            return postRepository
                .createQueryBuilder("post")
                .where("post.id=:id", { id: savedPost.id })
                .getOne()
                .should.eventually.eql(expectedPost)
        })

        it("should load saved post without details if left joins are not specified", function () {
            const expectedDetails = new PostDetails()
            expectedDetails.id = savedPost.details[0].id
            expectedDetails.authorName = savedPost.details[0].authorName
            expectedDetails.comment = savedPost.details[0].comment
            expectedDetails.metadata = savedPost.details[0].metadata

            return postDetailsRepository
                .createQueryBuilder("details")
                .where("details.id=:id", { id: savedPost.id })
                .getOne()
                .should.eventually.eql(expectedDetails)
        })
    })

    describe("insert post and category (one-side relation)", function () {
        if (!dataSource) return
        let newPost: Post, category: PostCategory, savedPost: Post

        before(reloadDatabase)

        before(function () {
            category = new PostCategory()
            category.name = "technology"

            newPost = new Post()
            newPost.text = "Hello post"
            newPost.title = "this is post title"
            newPost.categories = []
            newPost.categories.push(category)

            return postRepository
                .save(newPost)
                .then((post) => (savedPost = post as Post))
        })

        it("should return the same post instance after its created", function () {
            savedPost.should.be.equal(newPost)
        })

        it("should return the same post category instance after its created", function () {
            savedPost.categories.should.be.equal(newPost.categories)
        })

        it("should have a new generated id after post is created", function () {
            expect(savedPost.id).not.to.be.undefined
            expect(savedPost.categories[0].id).not.to.be.undefined
        })

        it("should have inserted post in the database", function () {
            const expectedPost = new Post()
            expectedPost.id = savedPost.id
            expectedPost.text = savedPost.text
            expectedPost.title = savedPost.title
            return postRepository
                .findOneBy({
                    id: savedPost.id,
                })
                .should.eventually.eql(expectedPost)
        })

        it("should have inserted category in the database", function () {
            const expectedPost = new PostCategory()
            expectedPost.id = savedPost.categories[0].id
            expectedPost.name = "technology"
            return postCategoryRepository
                .findOneBy({
                    id: savedPost.categories[0].id,
                })
                .should.eventually.eql(expectedPost)
        })

        it("should load post and its category if left join used", function () {
            const expectedPost = new Post()
            expectedPost.id = savedPost.id
            expectedPost.title = savedPost.title
            expectedPost.text = savedPost.text
            expectedPost.categories = []
            expectedPost.categories.push(new PostCategory())
            expectedPost.categories[0].id = savedPost.categories[0].id
            expectedPost.categories[0].name = savedPost.categories[0].name

            return postRepository
                .createQueryBuilder("post")
                .leftJoinAndSelect("post.categories", "categories")
                .where("post.id=:id", { id: savedPost.id })
                .getOne()
                .should.eventually.eql(expectedPost)
        })

        it("should load details and its post if left join used (from reverse side)", function () {
            // later need to specify with what exception we reject it
            /*return postCategoryRepository
                .createQueryBuilder("category")
                .leftJoinAndSelect("category.post", "post")
                .where("category.id=:id", { id: savedPost.id })
                .getSingleResult()
                .should.be.rejectedWith(Error);*/
            // not working, find fix
        })
    })

    describe("cascade updates should not be executed when cascadeUpdate option is not set", function () {
        if (!dataSource) return
        let newPost: Post, details: PostDetails

        before(reloadDatabase)

        before(function () {
            details = new PostDetails()
            details.authorName = "Umed"
            details.comment = "this is post"
            details.metadata = "post,posting,postman"

            newPost = new Post()
            newPost.text = "Hello post"
            newPost.title = "this is post title"
            newPost.details = []
            newPost.details.push(details)

            return postRepository.save(newPost)
        })

        it("should ignore updates in the model and do not update the db when entity is updated", function () {
            newPost.details[0].comment = "i am updated comment"
            return postRepository
                .save(newPost)
                .then((updatedPost: any) => {
                    // temporary
                    updatedPost!.details![0]!.comment!.should.be.equal(
                        "i am updated comment",
                    )
                    return postRepository
                        .createQueryBuilder("post")
                        .leftJoinAndSelect("post.details", "details")
                        .where("post.id=:id")
                        .setParameter("id", updatedPost.id)
                        .getOne()
                })
                .then((updatedPostReloaded) => {
                    updatedPostReloaded!.details[0].comment!.should.be.equal(
                        "this is post",
                    )
                })
        }) // todo: also check that updates throw exception in strict cascades mode
    })

    describe("cascade remove should not be executed when cascadeRemove option is not set", function () {
        if (!dataSource) return
        let newPost: Post, details: PostDetails

        before(reloadDatabase)

        before(function () {
            details = new PostDetails()
            details.authorName = "Umed"
            details.comment = "this is post"
            details.metadata = "post,posting,postman"

            newPost = new Post()
            newPost.text = "Hello post"
            newPost.title = "this is post title"
            newPost.details = []
            newPost.details.push(details)

            return postRepository.save(newPost)
        })

        it("should remove relation however should not remove details itself", function () {
            newPost.details = []
            return postRepository
                .save(newPost)
                .then((updatedPost) => {
                    return postRepository
                        .createQueryBuilder("post")
                        .leftJoinAndSelect("post.details", "details")
                        .where("post.id=:id")
                        .setParameter("id", updatedPost.id)
                        .getOne()
                })
                .then((updatedPostReloaded) => {
                    expect(updatedPostReloaded!.details).to.be.eql([])

                    return postDetailsRepository
                        .createQueryBuilder("details")
                        .leftJoinAndSelect("details.posts", "posts")
                        .where("details.id=:id")
                        .setParameter("id", details.id)
                        .getOne()
                })
                .then((reloadedDetails) => {
                    expect(reloadedDetails).not.to.be.null
                    expect(reloadedDetails!.posts).to.be.eql([])
                })
        })
    })

    describe("cascade updates should be executed when cascadeUpdate option is set", function () {
        if (!dataSource) return
        let newPost: Post, newImage: PostImage

        before(reloadDatabase)

        it("should update a relation successfully when updated", function () {
            newImage = new PostImage()
            newImage.url = "logo.png"

            newPost = new Post()
            newPost.text = "Hello post"
            newPost.title = "this is post title"

            return postImageRepository
                .save(newImage)
                .then((image) => {
                    newPost.images = []
                    newPost.images.push(image as PostImage)
                    return postRepository.save(newPost)
                })
                .then((post) => {
                    newPost = post as Post
                    return postRepository
                        .createQueryBuilder("post")
                        .leftJoinAndSelect("post.images", "images")
                        .where("post.id=:id")
                        .setParameter("id", post.id)
                        .getOne()
                })
                .then((loadedPost) => {
                    loadedPost!.images[0].url = "new-logo.png"
                    return postRepository.save(loadedPost!)
                })
                .then(() => {
                    return postRepository
                        .createQueryBuilder("post")
                        .leftJoinAndSelect("post.images", "images")
                        .where("post.id=:id")
                        .setParameter("id", newPost.id)
                        .getOne()
                })
                .then((reloadedPost) => {
                    reloadedPost!.images[0].url.should.be.equal("new-logo.png")
                })
        })
    })

    describe("cascade remove should be executed when cascadeRemove option is set", function () {
        if (!dataSource) return
        let newPost: Post, newMetadata: PostMetadata

        before(reloadDatabase)

        it("should remove a relation entity successfully when removed", function () {
            newMetadata = new PostMetadata()
            newMetadata.description = "this is post metadata"

            newPost = new Post()
            newPost.text = "Hello post"
            newPost.title = "this is post title"

            return postMetadataRepository
                .save(newMetadata)
                .then((metadata) => {
                    newPost.metadatas = []
                    newPost.metadatas.push(metadata as PostMetadata)
                    return postRepository.save(newPost)
                })
                .then((post) => {
                    newPost = post as Post
                    return postRepository
                        .createQueryBuilder("post")
                        .leftJoinAndSelect("post.metadatas", "metadatas")
                        .where("post.id=:id")
                        .setParameter("id", post.id)
                        .getOne()
                })
                .then((loadedPost) => {
                    loadedPost!.metadatas = []
                    return postRepository.save(loadedPost as Post)
                })
                .then(() => {
                    return postRepository
                        .createQueryBuilder("post")
                        .leftJoinAndSelect("post.metadatas", "metadatas")
                        .where("post.id=:id")
                        .setParameter("id", newPost.id)
                        .getOne()
                })
                .then((reloadedPost) => {
                    expect(reloadedPost!.metadatas).to.be.eql([])
                })
        })
    })

    describe("insert post details from reverse side", function () {
        if (!dataSource) return
        let newPost: Post, details: PostDetails, savedDetails: PostDetails

        before(reloadDatabase)

        before(function () {
            newPost = new Post()
            newPost.text = "Hello post"
            newPost.title = "this is post title"

            details = new PostDetails()
            details.comment = "post details comment"
            details.posts = []
            details.posts.push(newPost)

            return postDetailsRepository
                .save(details)
                .then((details) => (savedDetails = details as PostDetails))
        })

        it("should return the same post instance after its created", function () {
            savedDetails.posts[0].should.be.equal(newPost)
        })

        it("should return the same post details instance after its created", function () {
            savedDetails.should.be.equal(details)
        })

        it("should have a new generated id after post is created", function () {
            expect(savedDetails.id).not.to.be.undefined
            expect(details.id).not.to.be.undefined
        })

        it("should have inserted post in the database", function () {
            const expectedPost = new Post()
            expectedPost.id = newPost.id
            expectedPost.text = newPost.text
            expectedPost.title = newPost.title
            return postRepository
                .findOneBy({
                    id: savedDetails.id,
                })
                .should.eventually.eql(expectedPost)
        })

        it("should have inserted details in the database", function () {
            const expectedDetails = new PostDetails()
            expectedDetails.id = details.id
            expectedDetails.comment = details.comment
            expectedDetails.metadata = null
            expectedDetails.authorName = null
            return postDetailsRepository
                .findOneBy({
                    id: details.id,
                })
                .should.eventually.eql(expectedDetails)
        })

        it("should load post and its details if left join used", function () {
            const expectedDetails = new PostDetails()
            expectedDetails.id = savedDetails.id
            expectedDetails.comment = savedDetails.comment
            expectedDetails.metadata = null
            expectedDetails.authorName = null
            expectedDetails.posts = []
            expectedDetails.posts.push(new Post())
            expectedDetails.posts[0].id = newPost.id
            expectedDetails.posts[0].text = newPost.text
            expectedDetails.posts[0].title = newPost.title

            return postDetailsRepository
                .createQueryBuilder("details")
                .leftJoinAndSelect("details.posts", "posts")
                .where("details.id=:id", { id: savedDetails.id })
                .getOne()
                .should.eventually.eql(expectedDetails)
        })
    })
})
