import { jest } from "@jest/globals";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

const redisStore = new Map();
const redisMock = {
    once: jest.fn(),
    get: jest.fn(async (key) => redisStore.get(key) ?? null),
    set: jest.fn(async (key, value) => {
        redisStore.set(key, value);
        return "OK";
    }),
};

jest.unstable_mockModule("ioredis", () => ({
    default: jest.fn(() => redisMock),
}));

const { app, connectDB } = await import("../server.js");
const { User } = await import("../models/user.model.js");

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDB(mongoServer.getUri());
});

beforeEach(async () => {
    redisStore.clear();
    jest.clearAllMocks();
    await User.deleteMany({});
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

describe("User routes", () => {
    test("POST /user creates a user", async () => {
        const response = await request(app)
            .post("/user")
            .send({ name: "Test User", email: "test@example.com" })
            .expect(200);

        expect(response.body.message).toBe("User created successfully");
        expect(response.body.data).toMatchObject({
            name: "Test User",
            email: "test@example.com",
        });

        const user = await User.findOne({ email: "test@example.com" });
        expect(user).not.toBeNull();
    });

    test("GET /user/:id returns a user from MongoDB and caches it", async () => {
        const user = await User.create({
            name: "Mongo User",
            email: "mongo@example.com",
        });

        const response = await request(app)
            .get(`/user/${user._id}`)
            .expect(200);

        expect(response.body.message).toBe("User fetched successfully");
        expect(response.body.data).toMatchObject({
            name: "Mongo User",
            email: "mongo@example.com",
        });
        expect(redisMock.set).toHaveBeenCalledWith(
            `user:${user._id}`,
            expect.any(String),
            "EX",
            3600
        );
    });

    test("GET /user/:id returns cached user when Redis has it", async () => {
        const cachedUser = {
            _id: new mongoose.Types.ObjectId().toString(),
            name: "Cached User",
            email: "cached@example.com",
        };
        redisStore.set(`user:${cachedUser._id}`, JSON.stringify(cachedUser));

        const response = await request(app)
            .get(`/user/${cachedUser._id}`)
            .expect(200);

        expect(response.body.message).toBe("User fetched from cache");
        expect(response.body.data).toEqual(cachedUser);
        expect(redisMock.get).toHaveBeenCalledWith(`user:${cachedUser._id}`);
        expect(redisMock.set).not.toHaveBeenCalled();
    });
});
