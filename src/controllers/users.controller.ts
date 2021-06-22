import {Request, Response} from 'express'
import { ResponseStatus } from '../utils/status.utils'
import { User } from '../models/users.models'
import bcrypt from 'bcrypt'
import * as jwt from 'jsonwebtoken'
import fs from 'fs'
import sharp from 'sharp'

console.log('Imported user controller')

export module userCont {
    let saltRounds: number = 10

    //Function for signing up a new user with password encryption
    //TODO: Add checkings for security
    //TODO: delete and regenerate token once a week or so.
    export async function register_C(req: Request, res: Response) {

        bcrypt.hash(req.body.password, saltRounds, (err, encrypted) => {
            if(err){
                return res.status(ResponseStatus.InternalError).end('Something went wrong!')
            }
            const userCred = {
                username: req.body.username,
                email: req.body.email,
                password: encrypted,
            }
            if(!userCred.username && !userCred.email && !userCred.password)
                return res.status(ResponseStatus.BadRequest).json({message: "Something went wrong, please try again"})
            
            try{
                const user = User.create(userCred, async (err, doc) => {
                    if(err)
                        return res.status(ResponseStatus.BadRequest).send(err)
                    
                    try{
                        const token = await generateAuthToken(doc._id.toString())
                        return res.status(ResponseStatus.Created).json(userData(doc, token))
                    }catch(e) {
                        res.status(ResponseStatus.InternalError).send(e)
                    }
                })
            }catch(e) {
                res.status(ResponseStatus.InternalError).send(`Error: ${e}`)
            }
        })
    }

    //Function for logging in a user and generating a token
    export async function login_C(req: Request, res: Response) {
        try{
            const user = await User.findOne({email: req.body.email})
            if(!user)
                return res.status(ResponseStatus.NotFound).json({message: 'Could not find user'})

            const isMatch = await bcrypt.compare(req.body.password, user.password)
            if(!isMatch)
                return res.status(ResponseStatus.BadRequest).json({message: 'Something went wrong'})

            const token = await generateAuthToken(user._id)

            res.send(userData(user, token))
        }catch(e) {
            res.status(ResponseStatus.BadRequest).send(e)
        }
    }

    //Function for reading the current logged user
    export async function read_C(req: Request, res: Response) {
        res.send(userData(req.body.user, req.body.token))
    }

    //Function for getting user image by id
    export async function getImage_C(req: Request, res: Response) {
        try{
            const user = await User.findById(req.params.id)
            
            if(!user)
                return res.status(ResponseStatus.BadRequest)
            
            const profilePic = await sharp(`${__dirname}/../images/${user.profilePic}`).resize({ width: 250, height: 250 }).png().toBuffer()

            if(!profilePic)
                return res.status(ResponseStatus.BadRequest).send()
            
            res.set('Content-Type','image/png')
            res.send(profilePic)
        } catch(e) {
            res.status(ResponseStatus.InternalError).send(e)
        }
    }

    //Function for uploading a new profile image for the user
    export async function uploadImage_C(req: Request, res: Response) {
        try{
            const token = req.header('Authorization')?.replace('Bearer ', '')
            const user = await User.findOne({ 'tokens.token': token})
            if(!user)
                return res.status(ResponseStatus.NotFound).send()
            
            user.profilePic = req.file.filename
            
            await user.save()
            res.send()
        }catch(e) {
            res.status(ResponseStatus.BadRequest).send(e)
        }
    }

    //Function for updating a logged user's data
    //json body request should be under "update":{}
    //TODO: add checking for all updates, especially password
    //TODO: this function on test throws an unhandled promise when trying to change password(but not when trying to change something else), fix that
    export async function updateUser_C(req: Request, res: Response) {
        const bodyData: string[] = Object.keys(req.body.update)
        const allowedChanges: string[] = ['username', 'email', 'password']
        const isOperationValid = bodyData.every(data => allowedChanges.includes(data))

        if(!isOperationValid)
            return res.status(ResponseStatus.BadRequest).json({error: 'Invalid updates'})

        try{
            bodyData.forEach(data => req.body.user[data] = req.body.update[data])

            if(bodyData.includes('password')){
                await bcrypt.hash(req.body.update.password, saltRounds, (err, encrypted) => {
                    if(err)
                        return res.status(ResponseStatus.InternalError).json({error: 'Something went wrong'})
                    req.body.user.password = encrypted
                    req.body.user.save()
                })
            }else{
                await req.body.user.save()
            }

            res.send(userData(req.body.user, req.body.token))
        }catch(e) {
            res.status(ResponseStatus.BadRequest).send(e)
        }

    }

    //Function for deleting a connected user, takes password as an argument for extra protection
    export async function deleteUser_C(req: Request, res: Response) {
        try{
            if(!req.body.password)
                return res.status(ResponseStatus.BadRequest).send()

            bcrypt.compare(req.body.password, req.body.user.password, (err, result) => {
                if(err || !result)
                    return res.status(ResponseStatus.NotFound).json({error: 'Something went wrong'})
            })
            
            await req.body.user.delete()
            res.send(userData(req.body.user, req.body.token))
        }catch(e) {
            res.status(ResponseStatus.InternalError).send(e)
        }
    }

    //Function for deleting user's profile picture and the default picture would replace it
    export async function deleteImg_C(req: Request, res: Response) {
        try{
            fs.unlinkSync(`${__dirname}/../images/${req.body.user.profilePic}`)

            req.body.user.profilePic = 'default.png'
            await req.body.user.save()
            res.send()
        }catch(e) {
            res.status(ResponseStatus.InternalError).send()
        }
    }

    //Function for logging out of a specific user
    export async function logout_C(req: Request, res: Response) {
        try{
            req.body.user.tokens = req.body.user.tokens.filter((token: { token: any }) => {
                return token.token !== req.body.token
            })

            await req.body.user.save()
            res.send('Logged out successfully')
        }catch(e) {
            res.status(ResponseStatus.InternalError).send(e)
        }
    }

    //Function for logging out of all connected users
    export async function logoutAll_C(req: Request, res: Response) {
        try{
            req.body.user.tokens = []
            await req.body.user.save()

            res.send('Logged out of all users')
        }catch(e) {
            res.status(ResponseStatus.InternalError).send(e)
        }
    }

    //Function for generating a new function
    async function generateAuthToken(userId: string) {
        const token = jwt.sign({_id: userId}, process.env.JWT_SECRET as string)
        
        await User.updateOne({_id: userId}, {$push: {tokens: {token: token}}})

        return token
    }

    //Function that returns the desired data for a response of a user
    function userData(data: any, token: any) {
        return {
            user: {
                _id: data._id,
                username: data.username,
                email: data.email,
                token
            }
        }
    }
}