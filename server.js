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
        ssl: {
            rejectUnauthorized: false
        }
    });

    pool.on("error", function(error) {
        console.error("PostgreSQL xatosi:", error.message);
    });
}

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

        databaseReady = true;

        console.log("PostgreSQL: gps_rooms tayyor.");
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

    const result = await pool.query(
        "SELECT id FROM gps_rooms WHERE room_code = $1 LIMIT 1",
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
        ws.readyState ===
        WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify(data)
        );
    }
}

function broadcast(code, data) {
    const room = rooms.get(code);

    if (!room) {
        return;
    }

    for (
        const user of room.values()
    ) {
        send(
            user.ws,
            data
        );
    }
}

function getUsers(code) {
    const room =
        rooms.get(code);

    if (!room) {
        return [];
    }

    return Array.from(
        room.values()
    ).map(
        function(user) {
            return {
                id: user.id,
                name: user.name,
                lat: user.lat,
                lng: user.lng,
                accuracy: user.accuracy,
                online: user.online
            };
        }
    );
}

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
                crypto.randomInt(
                    0,
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

        if (!databaseReady) {
            if (!rooms.has(code)) {
                return code;
            }

            continue;
        }

        if (
            !(await roomExists(code))
        ) {
            return code;
        }
    }

    return null;
}

wss.on(
    "connection",
    function(ws) {
        const user = {
            id: createUserId(),
            name: "Foydalanuvchi",
            roomCode: null,
            lat: null,
            lng: null,
            accuracy: null,
            online: true,
            ws: ws
        };

        send(
            ws,
            {
                type: "connected",
                id: user.id
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
                                    type: "error",
                                    message:
                                        "Guruh yaratib bo'lmadi."
                                }
                            );

                            return;
                        }

                        await createRoomInDatabase(
                            code
                        );

                        rooms.set(
                            code,
                            new Map()
                        );

                        const room =
                            rooms.get(code);

                        user.roomCode =
                            code;

                        user.name =
                            String(
                                data.name ||
                                "Foydalanuvchi"
                            )
                                .trim()
                                .slice(
                                    0,
                                    30
                                );

                        room.set(
                            user.id,
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
                                    type:
                                        "error",
                                    message:
                                        "Guruh kodini kiriting."
                                }
                            );

                            return;
                        }

                        const roomExistsInMemory =
                            rooms.has(
                                code
                            );

                        const roomExistsInDatabase =
                            databaseReady
                                ? await roomExists(
                                      code
                                  )
                                : false;

                        if (
                            !roomExistsInMemory &&
                            !roomExistsInDatabase
                        ) {
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
                            !rooms.has(code)
                        ) {
                            rooms.set(
                                code,
                                new Map()
                            );
                        }

                        const room =
                            rooms.get(code);

                        user.roomCode =
                            code;

                        user.name =
                            String(
                                data.name ||
                                "Foydalanuvchi"
                            )
                                .trim()
                                .slice(
                                    0,
                                    30
                                );

                        user.online =
                            true;

                        room.set(
                            user.id,
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
                                data.accuracy ||
                                0
                            );

                        if (
                            !Number.isFinite(
                                lat
                            ) ||
                            !Number.isFinite(
                                lng
                            )
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
                                .slice(
                                    0,
                                    30
                                );

                        if (
                            user.roomCode
                        ) {
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

        ws.on(
            "close",
            function() {
                user.online =
                    false;

                if (
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

                room.delete(
                    user.id
                );

                if (
                    room.size === 0
                ) {
                    rooms.delete(
                        user.roomCode
                    );

                    return;
                }

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

app.get(
    "/health",
    function(req, res) {
        res.json({
            status: "ok",
            database:
                databaseReady
                    ? "connected"
                    : "local-mode"
        });
    }
);

async function startServer() {
    await initDatabase();

    server.listen(
        PORT,
        function() {
            console.log(
                "Live GPS: http://localhost:" +
                PORT
            );

            if (
                databaseReady
            ) {
                console.log(
                    "PostgreSQL: ulandi"
                );

                console.log(
                    "Guruhlar: bazada saqlanadi"
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