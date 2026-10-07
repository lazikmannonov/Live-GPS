const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "";

let pool = null;
let databaseReady = false;

if (DATABASE_URL) {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    pool.on("error", function(error) {
        console.error("PostgreSQL xatosi:", error.message);
    });
}


/* =====================================================
   DATABASE
===================================================== */

async function initDatabase() {

    if (!pool) {
        console.log("PostgreSQL: DATABASE_URL topilmadi.");
        console.log("Lokal rejimda ishlayapmiz.");
        return;
    }

    try {

        await pool.query(
            "CREATE TABLE IF NOT EXISTS gps_rooms (" +
            "id SERIAL PRIMARY KEY, " +
            "room_code VARCHAR(6) UNIQUE NOT NULL, " +
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, " +
            "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        );

        await pool.query(
            "CREATE TABLE IF NOT EXISTS gps_members (" +
            "id SERIAL PRIMARY KEY, " +
            "room_code VARCHAR(6) NOT NULL, " +
            "user_id VARCHAR(100) NOT NULL, " +
            "name VARCHAR(30) NOT NULL DEFAULT 'Foydalanuvchi', " +
            "lat DOUBLE PRECISION, " +
            "lng DOUBLE PRECISION, " +
            "accuracy DOUBLE PRECISION, " +
            "online BOOLEAN DEFAULT FALSE, " +
            "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, " +
            "UNIQUE(room_code, user_id))"
        );

        databaseReady = true;

        console.log("PostgreSQL: gps_rooms tayyor.");
        console.log("PostgreSQL: gps_members tayyor.");

    } catch (error) {

        databaseReady = false;

        console.error(
            "PostgreSQL ulanish xatosi:",
            error.message
        );

        console.log(
            "Server lokal rejimda davom etadi."
        );
    }
}


async function roomExists(code) {

    if (!databaseReady || !pool) {
        return false;
    }

    const result =
        await pool.query(
            "SELECT id FROM gps_rooms " +
            "WHERE room_code = $1 LIMIT 1",
            [code]
        );

    return result.rows.length > 0;
}


async function createRoomInDatabase(code) {

    if (!databaseReady || !pool) {
        return;
    }

    await pool.query(
        "INSERT INTO gps_rooms (room_code) " +
        "VALUES ($1) " +
        "ON CONFLICT (room_code) DO NOTHING",
        [code]
    );
}


async function updateRoom(code) {

    if (!databaseReady || !pool) {
        return;
    }

    await pool.query(
        "UPDATE gps_rooms " +
        "SET updated_at = CURRENT_TIMESTAMP " +
        "WHERE room_code = $1",
        [code]
    );
}


/* =====================================================
   MEMBER DATABASE
===================================================== */

async function saveMemberToDatabase(user) {

    if (
        !databaseReady ||
        !pool ||
        !user ||
        !user.roomCode
    ) {
        return;
    }

    await pool.query(
        "INSERT INTO gps_members " +
        "(room_code, user_id, name, lat, lng, accuracy, online, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP) " +
        "ON CONFLICT (room_code, user_id) " +
        "DO UPDATE SET " +
        "name = EXCLUDED.name, " +
        "lat = EXCLUDED.lat, " +
        "lng = EXCLUDED.lng, " +
        "accuracy = EXCLUDED.accuracy, " +
        "online = EXCLUDED.online, " +
        "updated_at = CURRENT_TIMESTAMP",
        [
            user.roomCode,
            user.id,
            user.name,
            user.lat,
            user.lng,
            user.accuracy,
            user.online
        ]
    );
}


async function updateMemberLocationInDatabase(user) {

    if (
        !databaseReady ||
        !pool ||
        !user ||
        !user.roomCode
    ) {
        return;
    }

    await pool.query(
        "UPDATE gps_members SET " +
        "lat = $1, " +
        "lng = $2, " +
        "accuracy = $3, " +
        "online = TRUE, " +
        "updated_at = CURRENT_TIMESTAMP " +
        "WHERE room_code = $4 AND user_id = $5",
        [
            user.lat,
            user.lng,
            user.accuracy,
            user.roomCode,
            user.id
        ]
    );
}


async function setMemberOfflineInDatabase(user) {

    if (
        !databaseReady ||
        !pool ||
        !user ||
        !user.roomCode
    ) {
        return;
    }

    await pool.query(
        "UPDATE gps_members SET " +
        "online = FALSE, " +
        "updated_at = CURRENT_TIMESTAMP " +
        "WHERE room_code = $1 AND user_id = $2",
        [
            user.roomCode,
            user.id
        ]
    );
}


async function loadMembersFromDatabase(code) {

    if (!databaseReady || !pool) {
        return [];
    }

    const result =
        await pool.query(
            "SELECT " +
            "user_id, name, lat, lng, accuracy, online " +
            "FROM gps_members " +
            "WHERE room_code = $1 " +
            "ORDER BY updated_at ASC",
            [code]
        );

    return result.rows;
}


/* =====================================================
   SERVER / ROOMS
===================================================== */

app.use(
    express.static(
        path.join(__dirname)
    )
);


const rooms = new Map();


function createUserId() {

    return crypto
        .randomBytes(8)
        .toString("hex");
}


function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify(data)
        );
    }
}


function broadcast(code, data) {

    const room =
        rooms.get(code);

    if (!room) {
        return;
    }

    for (const user of room.values()) {

        if (user.ws) {

            send(
                user.ws,
                data
            );

        }
    }
}


function getUsers(code) {

    const room =
        rooms.get(code);

    if (!room) {
        return [];
    }

    return Array
        .from(room.values())
        .map(function(user) {

            return {
                id: user.id,
                name: user.name,
                lat: user.lat,
                lng: user.lng,
                accuracy: user.accuracy,
                online: user.online
            };

        });
}


function generateRoomCode() {

    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let code = "";

    for (let i = 0; i < 6; i++) {

        code +=
            chars[
                crypto.randomInt(
                    0,
                    chars.length
                )
            ];
    }

    return code;
}


async function getAvailableRoomCode() {

    for (let i = 0; i < 50; i++) {

        const code =
            generateRoomCode();

        if (!databaseReady) {

            if (!rooms.has(code)) {
                return code;
            }

            continue;
        }

        if (!(await roomExists(code))) {
            return code;
        }
    }

    return null;
}


/* =====================================================
   LOAD ROOM FROM DATABASE
===================================================== */

async function ensureRoomLoaded(code) {

    if (rooms.has(code)) {
        return rooms.get(code);
    }

    const room =
        new Map();

    if (databaseReady) {

        const members =
            await loadMembersFromDatabase(
                code
            );

        members.forEach(
            function(member) {

                room.set(
                    member.user_id,
                    {
                        id:
                            member.user_id,

                        name:
                            member.name ||
                            "Foydalanuvchi",

                        roomCode:
                            code,

                        lat:
                            member.lat !== null
                                ? Number(member.lat)
                                : null,

                        lng:
                            member.lng !== null
                                ? Number(member.lng)
                                : null,

                        accuracy:
                            member.accuracy !== null
                                ? Number(member.accuracy)
                                : null,

                        online:false,

                        ws:null
                    }
                );

            }
        );
    }

    rooms.set(
        code,
        room
    );

    return room;
}


/* =====================================================
   WEBSOCKET
===================================================== */

wss.on(
    "connection",
    function(ws) {

        const user = {

            id:
                createUserId(),

            name:
                "Foydalanuvchi",

            roomCode:
                null,

            lat:
                null,

            lng:
                null,

            accuracy:
                null,

            online:
                true,

            ws:
                ws
        };


        send(
            ws,
            {
                type:"connected",
                id:user.id
            }
        );


        ws.on(
            "message",
            async function(raw) {

                try {

                    const data =
                        JSON.parse(
                            raw.toString()
                        );


                    /* =================================
                       CREATE ROOM
                    ================================= */

                    if (
                        data.type ===
                        "create-room"
                    ) {

                        const code =
                            await getAvailableRoomCode();


                        if (!code) {

                            send(
                                ws,
                                {
                                    type:"error",
                                    message:
                                        "Guruh yaratib bo'lmadi."
                                }
                            );

                            return;
                        }


                        await createRoomInDatabase(
                            code
                        );


                        const room =
                            await ensureRoomLoaded(
                                code
                            );


                        const requestedUserId =
                            data.userId
                                ? String(
                                    data.userId
                                ).slice(0,100)
                                : "";


                        if (requestedUserId) {

                            user.id =
                                requestedUserId;

                        }


                        user.roomCode =
                            code;


                        user.name =
                            String(
                                data.name ||
                                "Foydalanuvchi"
                            )
                            .trim()
                            .slice(0,30);


                        user.online =
                            true;


                        user.ws =
                            ws;


                        room.set(
                            user.id,
                            user
                        );


                        await saveMemberToDatabase(
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


                        broadcast(
                            code,
                            {
                                type:
                                    "users",

                                users:
                                    getUsers(
                                        code
                                    )
                            }
                        );


                        console.log(
                            "Guruh yaratildi:",
                            code
                        );


                        return;
                    }


                    /* =================================
                       JOIN ROOM
                    ================================= */

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


                        if (!code) {

                            send(
                                ws,
                                {
                                    type:"error",
                                    message:
                                        "Guruh kodini kiriting."
                                }
                            );

                            return;
                        }


                        const existsInMemory =
                            rooms.has(code);


                        const existsInDatabase =
                            databaseReady
                                ? await roomExists(code)
                                : false;


                        if (
                            !existsInMemory &&
                            !existsInDatabase
                        ) {

                            send(
                                ws,
                                {
                                    type:"error",
                                    message:
                                        "Bunday guruh topilmadi."
                                }
                            );

                            return;
                        }


                        const room =
                            await ensureRoomLoaded(
                                code
                            );


                        const requestedUserId =
                            data.userId
                                ? String(
                                    data.userId
                                ).slice(0,100)
                                : "";


                        if (requestedUserId) {

                            user.id =
                                requestedUserId;

                        }


                        const oldUser =
                            room.get(
                                user.id
                            );


                        user.roomCode =
                            code;


                        user.name =
                            String(
                                data.name ||
                                "Foydalanuvchi"
                            )
                            .trim()
                            .slice(0,30);


                        user.online =
                            true;


                        user.ws =
                            ws;


                        if (
                            oldUser &&
                            Number.isFinite(
                                Number(
                                    oldUser.lat
                                )
                            ) &&
                            Number.isFinite(
                                Number(
                                    oldUser.lng
                                )
                            )
                        ) {

                            user.lat =
                                Number(
                                    oldUser.lat
                                );

                            user.lng =
                                Number(
                                    oldUser.lng
                                );

                            user.accuracy =
                                oldUser.accuracy;
                        }


                        room.set(
                            user.id,
                            user
                        );


                        await saveMemberToDatabase(
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


                        broadcast(
                            code,
                            {
                                type:
                                    "users",

                                users:
                                    getUsers(
                                        code
                                    )
                            }
                        );


                        console.log(
                            "Guruhga qo'shildi:",
                            code,
                            user.name
                        );


                        return;
                    }


                    /* =================================
                       LOCATION
                    ================================= */

                    if (
                        data.type ===
                        "location"
                    ) {

                        if (!user.roomCode) {
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
                                data.accuracy ||
                                0
                            );


                        if (
                            !Number.isFinite(lat) ||
                            !Number.isFinite(lng)
                        ) {
                            return;
                        }


                        if (
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
                            accuracy;


                        user.online =
                            true;


                        await updateMemberLocationInDatabase(
                            user
                        );


                        await updateRoom(
                            user.roomCode
                        );


                        broadcast(
                            user.roomCode,
                            {
                                type:
                                    "users",

                                users:
                                    getUsers(
                                        user.roomCode
                                    )
                            }
                        );


                        return;
                    }


                    /* =================================
                       NAME
                    ================================= */

                    if (
                        data.type ===
                        "name"
                    ) {

                        user.name =
                            String(
                                data.name ||
                                "Foydalanuvchi"
                            )
                            .trim()
                            .slice(0,30);


                        if (user.roomCode) {

                            await saveMemberToDatabase(
                                user
                            );


                            await updateRoom(
                                user.roomCode
                            );


                            broadcast(
                                user.roomCode,
                                {
                                    type:
                                        "users",

                                    users:
                                        getUsers(
                                            user.roomCode
                                        )
                                }
                            );
                        }


                        return;
                    }

                } catch (error) {

                    console.error(
                        "WebSocket xatosi:",
                        error.message
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


        /* =============================================
           DISCONNECT
        ============================================= */

        ws.on(
            "close",
            async function() {

                user.online =
                    false;


                user.ws =
                    null;


                if (!user.roomCode) {
                    return;
                }


                const code =
                    user.roomCode;


                const room =
                    rooms.get(code);


                if (!room) {
                    return;
                }


                const existingUser =
                    room.get(
                        user.id
                    );


                if (existingUser) {

                    existingUser.online =
                        false;

                    existingUser.ws =
                        null;


                    await setMemberOfflineInDatabase(
                        existingUser
                    );

                } else {

                    room.set(
                        user.id,
                        user
                    );


                    await setMemberOfflineInDatabase(
                        user
                    );
                }


                await updateRoom(
                    code
                );


                broadcast(
                    code,
                    {
                        type:
                            "users",

                        users:
                            getUsers(
                                code
                            )
                    }
                );


                console.log(
                    "Foydalanuvchi offline:",
                    user.name,
                    code
                );
            }
        );


        ws.on(
            "error",
            function(error) {

                console.error(
                    "WebSocket xatosi:",
                    error.message
                );
            }
        );
    }
);


/* =====================================================
   HEALTH
===================================================== */

app.get(
    "/health",
    function(req, res) {

        res.json({

            status:"ok",

            database:
                databaseReady
                    ? "connected"
                    : "local-mode"
        });
    }
);


/* =====================================================
   START
===================================================== */

async function startServer() {

    await initDatabase();


    server.listen(
        PORT,
        function() {

            console.log(
                "Live GPS: http://localhost:" +
                PORT
            );


            if (databaseReady) {

                console.log(
                    "PostgreSQL: ulandi"
                );

                console.log(
                    "Guruhlar va foydalanuvchilar bazada saqlanadi"
                );

            } else {

                console.log(
                    "PostgreSQL: hozircha ulanmagan"
                );

                console.log(
                    "Lokal rejim: ishlayapti"
                );
            }
        }
    );
}


/* =====================================================
   SHUTDOWN
===================================================== */

async function shutdown() {

    if (pool) {
        await pool.end();
    }


    server.close(
        function() {
            process.exit(0);
        }
    );
}


process.on(
    "SIGINT",
    shutdown
);


process.on(
    "SIGTERM",
    shutdown
);


startServer();
