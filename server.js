import "dotenv/config"
import morgan from "morgan"
import express from "express"
import Redis from "ioredis"
import mongoose from "mongoose"
import { User } from "./models/user.model.js"
import rateLimit from 'express-rate-limit'
const app = express();
app.use(morgan("dev"));
app.use(express.json());
app.use(express.static("public"))

const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message:{
        error:"Too many requests, please try again later."
    },
    statusCode:429,
    standardHeaders: true, // send ratelimit - headers
    legacyHeaders: false,

})

// ---MongoDB Connection---
const connectDB = async (mongoUri = process.env.MONGO_URI) =>{
    try{
        await mongoose.connect(mongoUri);
        console.log("Connected to DB");
    }
    catch(error){
        console.log("Error Connecting to DB", error);
        throw error;
    }
};

const redis = new Redis(process.env.REDIS_URI);


app.set("view engine","ejs");
app.set("views","./views");

redis.once("ready",() =>{
    console.log("Connected to Redis");
})

app.get("/user/:id", async (req,res)=>{

    try{
        const userFormCache = await redis.get(`user:${req.params.id}`);
        if(userFormCache){
            
            return res.json({
                message:"User fetched from cache",
                data: JSON.parse(userFormCache)
            })
        }
         
        const user = await User.findOne({_id: req.params.id});

        await redis.set(`user:${req.params.id}`,JSON.stringify(user),"EX", 3600
        ); //Cache for 1 hour

        res.json({
            message:"User fetched successfully",
            data: user
        })
    }catch(error){
        res.status(500).json({error:"Error fetching users"});
    }
})

app.post("/user", async (req,res) => {
    try{
        const newUser = new User(req.body);
        await newUser.save();
        res.json({
            message:"User created successfully",
            data: newUser
        });
    } catch(error){
        res.status(500).json({error:"Error creaating user"});
    }
})

app.get("/", (req,res)=>{
    res.render("index")
});

const PORT = process.env.PORT || 3000

const startServer = async () => {
    await connectDB();

    return app.listen(PORT, ()=>{
        console.log(`Server is running on ${PORT}`);
    });
}

if(process.env.NODE_ENV !== "test"){
    startServer();
}

export { app, connectDB, redis, startServer };

