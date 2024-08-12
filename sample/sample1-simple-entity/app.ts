import "reflect-metadata"
import { DataSource, DataSourceOptions } from "../../src/index"
import { Post } from "./entity/Post"

const options: DataSourceOptions = {
    name: "sap",
    type: "sap",
    host: "192.168.56.102",
    port: 39015,
    username: "SYSTEM",
    password: "MySuperHanaPwd123!",
    database: "HXE",
    logging: true,
    synchronize: true,
    entities: [Post],
}

const dataSource = new DataSource(options)
dataSource.initialize().then(
    async (dataSource) => {
        let post = new Post()
        post.text = "Hello how are you?"
        post.title = "hello"
        post.likesCount = 100

        let postRepository = dataSource.getRepository(Post)

        postRepository
            .save(post)
            .then((post) => console.log("Post has been saved: ", post))
            .catch((error) => console.log("Cannot save. Error: ", error))
    },
    (error) => console.log("Cannot connect: ", error),
)
