"use strict";

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = String(
    process.env.DATABASE_URL || ""
).trim();

let pool = null;
let databaseReady = false;

if (DATABASE_URL) {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
    server
});


/* =========================================================
   MEMORY
   ========================================================= */

const rooms = new Map();


/* =========================================================
   DATABASE
   ========================================================= */

async function initDatabase() {

    if (!pool) {
        console.log(
            "DATABASE_URL topilmadi. Local mode."
        );

        return;
    }

    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS gps_rooms (
                id SERIAL PRIMARY KEY,
                room_code VARCHAR(6) UNIQUE NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);


        await pool.query(`
            CREATE TABLE IF NOT EXISTS gps_members (
                room_code VARCHAR(6) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                name VARCHAR(100) NOT NULL,
                lat DOUBLE PRECISION,
                lng DOUBLE PRECISION,
                accuracy DOUBLE PRECISION,
                online BOOLEAN DEFAULT FALSE,
                last_seen TIMESTAMPTZ DEFAULT NOW(),

                PRIMARY KEY (
                    room_code,
                    user_id
                ),

                CONSTRAINT fk_gps_room
                FOREIGN KEY (room_code)
                REFERENCES gps_rooms(room_code)
                ON DELETE CASCADE
            )
        `);


        /*
         * Eski versiyada FOREIGN KEY bo'lmasligi mumkin.
         * Shuning uchun jadval mavjud bo'lsa ham normal ishlaydi.
         */


        databaseReady = true;

        console.log(
            "PostgreSQL tayyor."
        );


        /*
         * Server qayta ishga tushganda
         * mavjud barcha guruhlarni xotiraga yuklaymiz.
         */

        await loadAllRoomsFromDatabase();


    } catch (error) {

        databaseReady = false;

        console.error(
            "Database init error:",
            error
        );
    }
}


/* =========================================================
   LOAD ALL ROOMS
   ========================================================= */

async function loadAllRoomsFromDatabase() {

    if (
        !databaseReady ||
        !pool
    ) {
        return;
    }


    try {

        const result =
            await pool.query(`
                SELECT room_code
                FROM gps_rooms
                ORDER BY updated_at DESC
            `);


        for (
            const row
            of result.rows
        ) {

            const code =
                String(
                    row.room_code
                )
                    .trim()
                    .toUpperCase();


            if (
                /^[A-Z0-9]{6}$/.test(code)
            ) {

                await loadRoomFromDatabase(
                    code
                );
            }
        }


        console.log(
            `Database guruhlari yuklandi: ${rooms.size}`
        );


    } catch (error) {

        console.error(
            "Load all rooms error:",
            error
        );
    }
}


/* =========================================================
   ROOM EXISTS
   ========================================================= */

async function roomExists(code) {

    code =
        String(code || "")
            .trim()
            .toUpperCase();


    /*
     * Avval memory.
     */

    if (
        rooms.has(code)
    ) {
        return true;
    }


    /*
     * Keyin database.
     */

    if (
        !databaseReady ||
        !pool
    ) {
        return false;
    }


    try {

        const result =
            await pool.query(
                `
                    SELECT room_code
                    FROM gps_rooms
                    WHERE room_code=$1
                    LIMIT 1
                `,
                [code]
            );


        return (
            result.rows.length > 0
        );


    } catch (error) {

        console.error(
            "roomExists error:",
            error
        );

        return false;
    }
}


/* =========================================================
   CREATE ROOM
   ========================================================= */

async function createRoomInDatabase(
    code
) {

    if (
        !databaseReady ||
        !pool
    ) {
        return;
    }


    await pool.query(
        `
            INSERT INTO gps_rooms(
                room_code
            )
            VALUES($1)

            ON CONFLICT(room_code)
            DO UPDATE SET
                updated_at=NOW()
        `,
        [code]
    );
}


/* =========================================================
   UPDATE ROOM
   ========================================================= */

async function updateRoom(
    code
) {

    if (
        !databaseReady ||
        !pool
    ) {
        return;
    }


    await pool.query(
        `
            UPDATE gps_rooms
            SET updated_at=NOW()
            WHERE room_code=$1
        `,
        [code]
    );
}


/* =========================================================
   SAVE MEMBER
   ========================================================= */

async function saveMember(
    member
) {

    if (
        !databaseReady ||
        !pool ||
        !member ||
        !member.roomCode
    ) {
        return;
    }


    await pool.query(
        `
            INSERT INTO gps_members(
                room_code,
                user_id,
                name,
                lat,
                lng,
                accuracy,
                online,
                last_seen
            )

            VALUES(
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                NOW()
            )

            ON CONFLICT(
                room_code,
                user_id
            )

            DO UPDATE SET

                name=EXCLUDED.name,
                lat=EXCLUDED.lat,
                lng=EXCLUDED.lng,
                accuracy=EXCLUDED.accuracy,
                online=EXCLUDED.online,
                last_seen=NOW()
        `,
        [
            member.roomCode,
            member.id,
            member.name || "Noma'lum",
            Number.isFinite(
                Number(member.lat)
            )
                ? Number(member.lat)
                : null,
            Number.isFinite(
                Number(member.lng)
            )
                ? Number(member.lng)
                : null,
            Number.isFinite(
                Number(member.accuracy)
            )
                ? Number(member.accuracy)
                : null,
            !!member.online
        ]
    );
}


/* =========================================================
   LOAD ROOM
   ========================================================= */

async function loadRoomFromDatabase(
    code
) {

    if (
        !databaseReady ||
        !pool
    ) {
        return null;
    }


    code =
        String(code || "")
            .trim()
            .toUpperCase();


    try {

        /*
         * Guruhning o'zi borligini tekshiramiz.
         */

        const roomResult =
            await pool.query(
                `
                    SELECT room_code
                    FROM gps_rooms
                    WHERE room_code=$1
                    LIMIT 1
                `,
                [code]
            );


        if (
            roomResult.rows.length === 0
        ) {

            return null;
        }


        const result =
            await pool.query(
                `
                    SELECT
                        room_code,
                        user_id,
                        name,
                        lat,
                        lng,
                        accuracy,
                        online,
                        last_seen
                    FROM gps_members
                    WHERE room_code=$1
                    ORDER BY last_seen DESC
                `,
                [code]
            );


        const room =
            new Map();


        for (
            const row
            of result.rows
        ) {

            room.set(
                row.user_id,
                {
                    id: row.user_id,
                    roomCode: row.room_code,
                    name:
                        row.name ||
                        "Noma'lum",
                    lat: row.lat,
                    lng: row.lng,
                    accuracy:
                        row.accuracy,
                    online: false,
                    lastSeen:
                        row.last_seen,
                    ws: null
                }
            );
        }


        rooms.set(
            code,
            room
        );


        /*
         * Database'dagi odamlar server qayta
         * ishga tushganda offline bo'ladi.
         * Joylashuvi esa saqlanib qoladi.
         */

        await pool.query(
            `
                UPDATE gps_members
                SET online=FALSE
                WHERE room_code=$1
            `,
            [code]
        );


        return room;


    } catch (error) {

        console.error(
            "loadRoomFromDatabase error:",
            error
        );

        return null;
    }
}


/* =========================================================
   ENSURE ROOM LOADED
   ========================================================= */

async function ensureRoomLoaded(
    code
) {

    code =
        String(code || "")
            .trim()
            .toUpperCase();


    /*
     * Memory'da bor.
     */

    if (
        rooms.has(code)
    ) {

        return rooms.get(code);
    }


    /*
     * Database'dan yuklash.
     */

    if (
        databaseReady &&
        pool
    ) {

        const exists =
            await roomExists(
                code
            );


        if (!exists) {

            return null;
        }


        return await loadRoomFromDatabase(
            code
        );
    }


    return null;
}


/* =========================================================
   APP
   ========================================================= */

app.use(
    express.static(
        __dirname
    )
);


app.get(
    "/health",
    async (req, res) => {

        let databaseTest = false;

        if (
            pool &&
            databaseReady
        ) {

            try {

                await pool.query(
                    "SELECT 1"
                );

                databaseTest = true;

            } catch {
                databaseTest = false;
            }
        }


        res.json({
            ok: true,
            database: databaseReady,
            databaseTest,
            rooms: rooms.size,
            time: new Date().toISOString()
        });
    }
);


/* =========================================================
   USER ID
   ========================================================= */

function generateUserId() {

    return crypto
        .randomBytes(8)
        .toString("hex");
}


function normalizeUserId(
    id
) {

    const value =
        String(id || "")
            .trim()
            .toLowerCase();


    return /^[a-f0-9]{16}$/.test(
        value
    )
        ? value
        : null;
}


/* =========================================================
   ROOM CODE
   ========================================================= */

function generateRoomCode() {

    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let code = "";


    for (
        let i = 0;
        i < 6;
        i++
    ) {

        code +=
            chars[
                Math.floor(
                    Math.random() *
                    chars.length
                )
            ];
    }


    return code;
}


async function getAvailableRoomCode() {

    for (
        let i = 0;
        i < 50;
        i++
    ) {

        const code =
            generateRoomCode();


        const exists =
            await roomExists(
                code
            );


        if (!exists) {

            return code;
        }
    }


    throw new Error(
        "Guruh kodi yaratilmadi."
    );
}


/* =========================================================
   SOCKET HELPERS
   ========================================================= */

function send(
    ws,
    payload
) {

    if (
        ws &&
        ws.readyState ===
        WebSocket.OPEN
    ) {

        try {

            ws.send(
                JSON.stringify(
                    payload
                )
            );

        } catch {}
    }
}


function broadcast(
    room,
    payload
) {

    if (!room) {
        return;
    }


    for (
        const member
        of room.values()
    ) {

        if (
            member.ws &&
            member.ws.readyState ===
            WebSocket.OPEN
        ) {

            send(
                member.ws,
                payload
            );
        }
    }
}


/* =========================================================
   USERS
   ========================================================= */

function getUsers(
    room
) {

    return Array
        .from(room.values())
        .map(
            member => ({
                id: member.id,
                name:
                    member.name ||
                    "Noma'lum",
                lat: member.lat,
                lng: member.lng,
                accuracy:
                    member.accuracy,
                online:
                    !!member.online,
                lastSeen:
                    member.lastSeen ||
                    null
            })
        );
}


function broadcastUsers(
    room
) {

    if (!room) {
        return;
    }


    broadcast(
        room,
        {
            type: "users",
            users:
                getUsers(room)
        }
    );
}


/* =========================================================
   OFFLINE
   ========================================================= */

async function markUserOffline(
    user,
    ws
) {

    if (
        !user ||
        !user.roomCode
    ) {
        return;
    }


    const room =
        rooms.get(
            user.roomCode
        );


    if (!room) {
        return;
    }


    const member =
        room.get(
            user.id
        );


    if (!member) {
        return;
    }


    /*
     * Eski socket yangi socketni offline
     * qilib qo'ymasligi uchun.
     */

    if (
        member.ws &&
        member.ws !== ws
    ) {
        return;
    }


    member.online = false;
    member.ws = null;
    member.lastSeen =
        new Date();


    try {

        await saveMember(
            member
        );

        await updateRoom(
            user.roomCode
        );

    } catch (error) {

        console.error(
            "Offline save error:",
            error
        );
    }


    broadcastUsers(
        room
    );
}


/* =========================================================
   LEAVE ROOM
   ========================================================= */

async function leaveCurrentRoom(
    user,
    ws
) {

    if (
        !user ||
        !user.roomCode
    ) {
        return;
    }


    const roomCode =
        user.roomCode;


    await markUserOffline(
        user,
        ws
    );


    user.roomCode =
        null;
}


/* =========================================================
   WEBSOCKET
   ========================================================= */

wss.on(
    "connection",
    ws => {

        const user = {

            id:
                generateUserId(),

            name:
                "Noma'lum",

            roomCode:
                null,

            lat:
                null,

            lng:
                null,

            accuracy:
                null,

            online:
                false,

            lastSeen:
                null,

            ws
        };


        send(
            ws,
            {
                type:
                    "connected",

                userId:
                    user.id
            }
        );


        ws.on(
            "message",
            async raw => {

                try {

                    const data =
                        JSON.parse(
                            raw.toString()
                        );


                    if (
                        !data ||
                        !data.type
                    ) {
                        return;
                    }


                    /* =================================================
                       CREATE ROOM
                       ================================================= */

                    if (
                        data.type ===
                        "create-room"
                    ) {

                        const code =
                            await getAvailableRoomCode();


                        if (
                            user.roomCode
                        ) {

                            await leaveCurrentRoom(
                                user,
                                ws
                            );
                        }


                        /*
                         * AVVAL database'ga guruhni yaratamiz.
                         */

                        await createRoomInDatabase(
                            code
                        );


                        const room =
                            new Map();


                        rooms.set(
                            code,
                            room
                        );


                        const requestedUserId =
                            normalizeUserId(
                                data.userId
                            );


                        if (
                            requestedUserId
                        ) {

                            user.id =
                                requestedUserId;
                        }


                        user.roomCode =
                            code;


                        user.name =
                            String(
                                data.name ||
                                "Noma'lum"
                            )
                                .trim()
                                .slice(
                                    0,
                                    100
                                );


                        user.online =
                            true;


                        user.ws =
                            ws;


                        user.lastSeen =
                            new Date();


                        room.set(
                            user.id,
                            user
                        );


                        await saveMember(
                            user
                        );


                        await updateRoom(
                            code
                        );


                        send(
                            ws,
                            {
                                type:
                                    "room-created",

                                roomCode:
                                    code,

                                userId:
                                    user.id
                            }
                        );


                        broadcastUsers(
                            room
                        );


                        return;
                    }


                    /* =================================================
                       JOIN ROOM
                       ================================================= */

                    if (
                        data.type ===
                        "join-room"
                    ) {

                        const code =
                            String(
                                data.roomCode ||
                                ""
                            )
                                .trim()
                                .toUpperCase();


                        if (
                            !/^[A-Z0-9]{6}$/.test(
                                code
                            )
                        ) {

                            send(
                                ws,
                                {
                                    type:
                                        "error",

                                    message:
                                        "Guruh kodi noto‘g‘ri."
                                }
                            );

                            return;
                        }


                        /*
                         * Muhim:
                         * F5 dan keyin ham database'dan
                         * mavjud guruhni yuklaymiz.
                         */

                        const room =
                            await ensureRoomLoaded(
                                code
                            );


                        if (!room) {

                            send(
                                ws,
                                {
                                    type:
                                        "error",

                                    message:
                                        "Bunday guruh topilmadi."
                                }
                            );

                            return;
                        }


                        if (
                            user.roomCode &&
                            user.roomCode !== code
                        ) {

                            await leaveCurrentRoom(
                                user,
                                ws
                            );
                        }


                        const requestedUserId =
                            normalizeUserId(
                                data.userId
                            );


                        let existingUser =
                            requestedUserId
                                ? room.get(
                                    requestedUserId
                                )
                                : null;


                        /*
                         * Eski user topildi.
                         * Demak F5 yoki reconnect.
                         */

                        if (
                            existingUser
                        ) {

                            /*
                             * Eski socket hali ochiq bo'lsa,
                             * uni yopamiz.
                             */

                            if (
                                existingUser.ws &&
                                existingUser.ws !== ws &&
                                existingUser.ws.readyState ===
                                WebSocket.OPEN
                            ) {

                                try {

                                    existingUser.ws.close();

                                } catch {}
                            }


                            user.id =
                                existingUser.id;


                            user.roomCode =
                                code;


                            user.name =
                                String(
                                    data.name ||
                                    existingUser.name ||
                                    "Noma'lum"
                                )
                                    .trim()
                                    .slice(
                                        0,
                                        100
                                    );


                            user.lat =
                                existingUser.lat;


                            user.lng =
                                existingUser.lng;


                            user.accuracy =
                                existingUser.accuracy;


                            user.online =
                                true;


                            user.ws =
                                ws;


                            user.lastSeen =
                                new Date();


                            room.set(
                                user.id,
                                user
                            );


                        } else {

                            /*
                             * Yangi odam.
                             */

                            if (
                                requestedUserId
                            ) {

                                user.id =
                                    requestedUserId;
                            }


                            user.roomCode =
                                code;


                            user.name =
                                String(
                                    data.name ||
                                    "Noma'lum"
                                )
                                    .trim()
                                    .slice(
                                        0,
                                        100
                                    );


                            user.online =
                                true;


                            user.ws =
                                ws;


                            user.lastSeen =
                                new Date();


                            room.set(
                                user.id,
                                user
                            );
                        }


                        /*
                         * Database'ga online holatda yozamiz.
                         */

                        await saveMember(
                            user
                        );


                        await updateRoom(
                            code
                        );


                        send(
                            ws,
                            {
                                type:
                                    "joined-room",

                                roomCode:
                                    code,

                                userId:
                                    user.id
                            }
                        );


                        broadcastUsers(
                            room
                        );


                        return;
                    }


                    /* =================================================
                       LOCATION
                       ================================================= */

                    if (
                        data.type ===
                        "location"
                    ) {

                        if (
                            !user.roomCode
                        ) {
                            return;
                        }


                        const lat =
                            Number(
                                data.lat
                            );


                        const lng =
                            Number(
                                data.lng
                            );


                        const accuracy =
                            Number(
                                data.accuracy
                            );


                        if (
                            !Number.isFinite(
                                lat
                            ) ||
                            !Number.isFinite(
                                lng
                            ) ||
                            lat < -90 ||
                            lat > 90 ||
                            lng < -180 ||
                            lng > 180
                        ) {

                            return;
                        }


                        user.lat =
                            lat;


                        user.lng =
                            lng;


                        user.accuracy =
                            Number.isFinite(
                                accuracy
                            )
                                ? accuracy
                                : null;


                        user.online =
                            true;


                        user.lastSeen =
                            new Date();


                        await saveMember(
                            user
                        );


                        await updateRoom(
                            user.roomCode
                        );


                        const room =
                            rooms.get(
                                user.roomCode
                            );


                        if (room) {

                            broadcastUsers(
                                room
                            );
                        }


                        return;
                    }


                    /* =================================================
                       NAME
                       ================================================= */

                    if (
                        data.type ===
                        "name"
                    ) {

                        if (
                            !user.roomCode
                        ) {
                            return;
                        }


                        user.name =
                            String(
                                data.name ||
                                "Noma'lum"
                            )
                                .trim()
                                .slice(
                                    0,
                                    100
                                );


                        await saveMember(
                            user
                        );


                        const room =
                            rooms.get(
                                user.roomCode
                            );


                        if (room) {

                            broadcastUsers(
                                room
                            );
                        }


                        return;
                    }


                    /* =================================================
                       LEAVE
                       ================================================= */

                    if (
                        data.type ===
                        "leave-room"
                    ) {

                        const roomCode =
                            user.roomCode;


                        await leaveCurrentRoom(
                            user,
                            ws
                        );


                        send(
                            ws,
                            {
                                type:
                                    "left-room"
                            }
                        );


                        if (roomCode) {

                            const room =
                                rooms.get(
                                    roomCode
                                );


                            if (room) {

                                broadcastUsers(
                                    room
                                );
                            }
                        }


                        return;
                    }


                } catch (error) {

                    console.error(
                        "WebSocket message error:",
                        error
                    );


                    send(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "Server xatosi yuz berdi."
                        }
                    );
                }
            }
        );


        /* =========================================================
           SOCKET CLOSE
           ========================================================= */

        ws.on(
            "close",
            async () => {

                try {

                    /*
                     * Agar bu eski socket bo'lsa,
                     * yangi socketni offline qilmaymiz.
                     */

                    if (
                        user.ws &&
                        user.ws !== ws
                    ) {
                        return;
                    }


                    await markUserOffline(
                        user,
                        ws
                    );


                    user.ws =
                        null;


                    user.online =
                        false;


                } catch (error) {

                    console.error(
                        "Socket close error:",
                        error
                    );
                }
            }
        );
    }
);


/* =========================================================
   PING
   ========================================================= */

setInterval(
    () => {

        for (
            const client
            of wss.clients
        ) {

            if (
                client.readyState ===
                WebSocket.OPEN
            ) {

                try {

                    client.ping();

                } catch {}
            }
        }

    },
    30000
);


/* =========================================================
   SHUTDOWN
   ========================================================= */

async function shutdown() {

    console.log(
        "Server yopilmoqda..."
    );


    for (
        const room
        of rooms.values()
    ) {

        for (
            const member
            of room.values()
        ) {

            member.online =
                false;

            member.ws =
                null;


            try {

                await saveMember(
                    member
                );

            } catch {}
        }
    }


    try {

        if (pool) {

            await pool.end();
        }

    } catch {}


    server.close(
        () => {
            process.exit(0);
        }
    );
}


process.on(
    "SIGTERM",
    shutdown
);


process.on(
    "SIGINT",
    shutdown
);


/* =========================================================
   START
   ========================================================= */

initDatabase()
    .then(
        () => {

            server.listen(
                PORT,
                () => {

                    console.log(
                        `Server ${PORT} portda ishlayapti.`
                    );

                }
            );
        }
    )
    .catch(
        error => {

            console.error(
                "Server start error:",
                error
            );


            server.listen(
                PORT,
                () => {

                    console.log(
                        `Server ${PORT} portda ishlayapti.`
                    );

                }
            );
        }
    );
