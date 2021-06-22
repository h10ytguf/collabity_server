import { Document } from 'mongoose'

export interface IUser extends Document {
    username: string,
    email: string,
    password: string,
    tokens: Array<object>,
    profilePic?: string,
}