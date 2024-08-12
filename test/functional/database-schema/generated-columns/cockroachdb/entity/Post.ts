import { Column, Entity, PrimaryGeneratedColumn } from "../../../../../../src"

@Entity()
export class Post {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    title: string

    @Column()
    useTitle: boolean

    @Column()
    firstName: string

    @Column()
    lastName: string

    @Column({
        asExpression: `concat("firstName",' ',"lastName")`,
    })
    virtualFullName: string

    @Column({
        asExpression: `CONCAT("firstName",' ',"lastName")`,
        generatedType: "STORED",
    })
    storedFullName: string

    @Column({
        asExpression: `"firstName" || "lastName"`,
        generatedType: "STORED",
    })
    name: string

    @Column({
        generatedType: "VIRTUAL",
        asExpression: `md5(coalesce("firstName",'0'))`,
        type: "varchar",
        length: 255,
        nullable: true,
    })
    nameHash: string
}
