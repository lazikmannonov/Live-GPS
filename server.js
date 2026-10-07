"use strict";

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

// =====================================================
// POSTGRESQL
// =====================================================

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

// =====================================================
// DATABASE INIT
// =====================================================

async function initDatabase() {
    if (!pool) {
        console.log("PostgreSQL: DATABASE_URL topilmadi.");
        console.log("Lokal rejimda ishlayapmiz.");
        return;
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gps_rooms (
                id SERIAL PRIMARY KEY,
                room_code VARCHAR(6) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS gps_members (
                room_code VARCHAR(6) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                name VARCHAR(30) NOT NULL,
                lat DOUBLE PRECISION,
                lng DOUBLE PRECISION,
                accuracy DOUBLE PRECISION,
                online BOOLEAN DEFAULT FALSE,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (room_code, user_id)
            )
        `);

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

// =====================================================
// DATABASE HELPERS
// =====================================================

async function roomExists(code) {
    if (!databaseReady || !pool) {
        return false;
    }

    const result = await pool.query(
        `
        SELECT id
        FROM gps_rooms
        WHERE room_code = $1
        LIMIT 1
        `,
        [code]
    );

    return result.rows.length > 0;
}

async function createRoomInDatabase(code) {
    if (!databaseReady || !pool) {
        return;
    }

    await pool.query(
        `
        INSERT INTO gps_rooms (room_code)
        VALUES ($1)
        ON CONFLICT (room_code) DO NOTHING
        `,
        [code]
    );
}

async function updateRoom(code) {
    if (!databaseReady || !pool) {
        return;
    }

    await pool.query(
        `
        UPDATE gps_rooms
        SET updated_at = CURRENT_TIMESTAMP
        WHERE room_code = $1
        `,
        [code]
    );
}

async function saveMember(user) {
    if (!databaseReady || !pool) {
        return;
    }

    if (!user || !user.roomCode || !user.id) {
        return;
    }

    const lastSeen = user.lastSeen
        ? new Date(user.lastSeen)
        : new Date();

    await pool.query(
        `
        INSERT INTO gps_members (
            room_code,
            user_id,
            name,
            lat,
            lng,
            accuracy,
            online,
            last_seen
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8
        )
        ON CONFLICT (room_code, user_id)
        DO UPDATE SET
            name = EXCLUDED.name,
            lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            accuracy = EXCLUDED.accuracy,
            online = EXCLUDED.online,
            last_seen = EXCLUDED.last_seen
        `,
        [
            user.roomCode,
            user.id,
            user.name || "Foydalanuvchi",
            user.lat,
            user.lng,
            user.accuracy,
            Boolean(user.online),
            lastSeen
        ]
    );
}

async function loadRoomFromDatabase(code) {
    if (!databaseReady || !pool) {
        return new Map();
    }

    const room = new Map();

    // Server qayta ishga tushganda hech kim online emas.
    await pool.query(
        `
        UPDATE gps_members
        SET online = false
        WHERE room_code = $1
        `,
        [code]
    );

    const result = await pool.query(
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
        WHERE room_code = $1
        ORDER BY last_seen ASC
        `,
        [code]
    );

    for (const row of result.rows) {
        room.set(row.user_id, {
            id: row.user_id,
            name: row.name || "Foydalanuvchi",
            roomCode: row.room_code,
            lat: row.lat !== null ? Number(row.lat) : null,
            lng: row.lng !== null ? Number(row.lng) : null,
            accuracy: row.accuracy !== null
                ? Number(row.accuracy)
                : null,
            online: false,
            ws: null,
            lastSeen: row.last_seen
                ? new Date(row.last_seen).getTime()
                : Date.now()
        });
    }

    rooms.set(code, room);

    return room;
}

// =====================================================
// EXPRESS
// =====================================================

app.use(express.static(path.join(__dirname)));

// =====================================================
// ROOMS
// =====================================================

const rooms = new Map();

// =====================================================
// USER ID
// =====================================================

function createUserId() {
    return crypto.randomBytes(8).toString("hex");
}

function normalizeUserId(value) {
    const id = String(value || "")
        .trim()
        .toLowerCase();

    if (!/^[a-f0-9]{16}$/.test(id)) {
        return null;
    }

    return id;
}

// =====================================================
// WEBSOCKET HELPERS
// =====================================================

function send(ws, data) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        try {
            ws.send(JSON.stringify(data));
        } catch (error) {
            console.error(
                "WebSocket send xatosi:",
                error.message
            );
        }
    }
}

function broadcast(code, data) {
    const room = rooms.get(code);

    if (!room) {
        return;
    }

    for (const user of room.values()) {
        if (
            user.ws &&
            user.ws.readyState === WebSocket.OPEN
        ) {
            send(user.ws, data);
        }
    }
}

function getUsers(code) {
    const room = rooms.get(code);

    if (!room) {
        return [];
    }

    return Array.from(room.values()).map(function(user) {
        return {
            id: user.id,
            name: user.name,
            lat: user.lat,
            lng: user.lng,
            accuracy: user.accuracy,
            online: Boolean(user.online),
            lastSeen: user.lastSeen
                ? new Date(user.lastSeen).toISOString()
                : null
        };
    });
}

async function broadcastUsers(code) {
    broadcast(code, {
        type: "users",
        users: getUsers(code)
    });
}

// =====================================================
// ROOM CODE
// =====================================================

function generateRoomCode() {
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let code = "";

    for (let i = 0; i < 6; i++) {
        code += chars[
            crypto.randomInt(0, chars.length)
        ];
    }

    return code;
}

async function getAvailableRoomCode() {
    for (let i = 0; i < 50; i++) {
        const code = generateRoomCode();

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

// =====================================================
// LOAD ROOM
// =====================================================

async function ensureRoomLoaded(code) {
    if (rooms.has(code)) {
        return rooms.get(code);
    }

    if (!databaseReady) {
        return null;
    }

    const exists = await roomExists(code);

    if (!exists) {
        return null;
    }

    return await loadRoomFromDatabase(code);
}

// =====================================================
// LEAVE CURRENT ROOM
// =====================================================

async function markUserOffline(user, ws) {
    if (!user || !user.roomCode) {
        return;
    }

    const code = user.roomCode;
    const room = rooms.get(code);

    if (!room) {
        return;
    }

    const member = room.get(user.id);

    if (!member) {
        return;
    }

    // Eski WebSocket yopilgan bo'lsa,
    // yangi ulanishni offline qilib qo'ymaslik.
    if (
        member.ws &&
        member.ws !== ws
    ) {
        return;
    }

    member.online = false;
    member.ws = null;
    member.lastSeen = Date.now();

    await saveMember(member);
    await updateRoom(code);
    await broadcastUsers(code);
}

async function leaveCurrentRoom(user, ws) {
    if (!user || !user.roomCode) {
        return;
    }

    const oldCode = user.roomCode;

    await markUserOffline(user, ws);

    user.roomCode = null;

    console.log(
        "Guruhdan chiqildi:",
        oldCode,
        user.name
    );
}

// =====================================================
// WEBSOCKET CONNECTION
// =====================================================

wss.on("connection", function(ws) {
    let user = {
        id: createUserId(),
        name: "Foydalanuvchi",
        roomCode: null,
        lat: null,
        lng: null,
        accuracy: null,
        online: false,
        ws: ws,
        lastSeen: Date.now()
    };

    // Heartbeat
    ws.isAlive = true;

    ws.on("pong", function() {
        ws.isAlive = true;
    });

    send(ws, {
        type: "connected",
        id: user.id
    });

    // =================================================
    // MESSAGE
    // =================================================

    ws.on("message", async function(raw) {
        try {
            const data = JSON.parse(
                raw.toString()
            );

            // =============================================
            // CREATE ROOM
            // =============================================

            if (data.type === "create-room") {
                const code =
                    await getAvailableRoomCode();

                if (!code) {
                    send(ws, {
                        type: "error",
                        message:
                            "Guruh yaratib bo'lmadi."
                    });

                    return;
                }

                // Agar foydalanuvchi boshqa guruhda bo'lsa
                if (user.roomCode) {
                    await leaveCurrentRoom(
                        user,
                        ws
                    );
                }

                await createRoomInDatabase(code);

                const room = new Map();

                rooms.set(code, room);

                const requestedUserId =
                    normalizeUserId(
                        data.userId
                    );

                if (requestedUserId) {
                    user.id = requestedUserId;
                }

                user.roomCode = code;

                user.name = String(
                    data.name ||
                    "Foydalanuvchi"
                )
                    .trim()
                    .slice(0, 30);

                user.online = true;
                user.ws = ws;
                user.lastSeen = Date.now();

                room.set(user.id, user);

                await saveMember(user);
                await updateRoom(code);

                send(ws, {
                    type: "room-created",
                    roomCode: code,
                    userId: user.id
                });

                await broadcastUsers(code);

                console.log(
                    "Guruh yaratildi:",
                    code,
                    user.name
                );

                return;
            }

            // =============================================
            // JOIN ROOM
            // =============================================

            if (data.type === "join-room") {
                const code = String(
                    data.roomCode || ""
                )
                    .trim()
                    .toUpperCase();

                if (!code) {
                    send(ws, {
                        type: "error",
                        message:
                            "Guruh kodini kiriting."
                    });

                    return;
                }

                let room =
                    await ensureRoomLoaded(code);

                if (!room) {
                    send(ws, {
                        type: "error",
                        message:
                            "Bunday guruh topilmadi."
                    });

                    return;
                }

                // Boshqa guruhda bo'lsa,
                // avval eski guruhdan offline qilamiz.
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

                let existingUser = null;

                if (requestedUserId) {
                    existingUser =
                        room.get(requestedUserId);
                }

                // =========================================
                // OLD USERNI QAYTA ULASH
                // =========================================

                if (existingUser) {
                    // Eski WebSocket hali ochiq bo'lsa,
                    // yangi ulanish ustunlik qiladi.
                    if (
                        existingUser.ws &&
                        existingUser.ws !== ws
                    ) {
                        try {
                            existingUser.ws.close(
                                1000,
                                "Reconnected"
                            );
                        } catch (error) {
                            // ignore
                        }
                    }

                    user = existingUser;

                    user.ws = ws;
                    user.online = true;
                    user.roomCode = code;

                    if (data.name) {
                        user.name = String(
                            data.name
                        )
                            .trim()
                            .slice(0, 30);
                    }

                    user.lastSeen = Date.now();

                    room.set(
                        user.id,
                        user
                    );
                } else {
                    // =====================================
                    // YANGI USER
                    // =====================================

                    if (requestedUserId) {
                        user.id =
                            requestedUserId;
                    }

                    user.roomCode = code;

                    user.name = String(
                        data.name ||
                        "Foydalanuvchi"
                    )
                        .trim()
                        .slice(0, 30);

                    user.online = true;
                    user.ws = ws;
                    user.lastSeen = Date.now();

                    room.set(
                        user.id,
                        user
                    );
                }

                await saveMember(user);
                await updateRoom(code);

                send(ws, {
                    type: "joined-room",
                    roomCode: code,
                    userId: user.id
                });

                await broadcastUsers(code);

                console.log(
                    "Guruhga qo'shildi:",
                    code,
                    user.name
                );

                return;
            }

            // =============================================
            // LOCATION
            // =============================================

            if (data.type === "location") {
                if (!user.roomCode) {
                    return;
                }

                const lat = Number(data.lat);
                const lng = Number(data.lng);
                const accuracy =
                    Number(data.accuracy || 0);

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

                user.lat = lat;
                user.lng = lng;
                user.accuracy =
                    Number.isFinite(accuracy)
                        ? accuracy
                        : null;

                user.online = true;
                user.ws = ws;
                user.lastSeen = Date.now();

                await saveMember(user);
                await updateRoom(
                    user.roomCode
                );

                await broadcastUsers(
                    user.roomCode
                );

                return;
            }

            // =============================================
            // NAME
            // =============================================

            if (data.type === "name") {
                user.name = String(
                    data.name ||
                    "Foydalanuvchi"
                )
                    .trim()
                    .slice(0, 30);

                user.lastSeen = Date.now();

                if (user.roomCode) {
                    await saveMember(user);
                    await updateRoom(
                        user.roomCode
                    );

                    await broadcastUsers(
                        user.roomCode
                    );
                }

                return;
            }

            // =============================================
            // LEAVE ROOM
            // =============================================

            if (data.type === "leave-room") {
                const oldRoom =
                    user.roomCode;

                await leaveCurrentRoom(
                    user,
                    ws
                );

                send(ws, {
                    type: "left-room",
                    roomCode: oldRoom
                });

                return;
            }

        } catch (error) {
            console.error(
                "WebSocket xatosi:",
                error.message
            );

            send(ws, {
                type: "error",
                message:
                    "Server xatosi yuz berdi."
            });
        }
    });

    // =================================================
    // CLOSE
    // =================================================

    ws.on("close", async function() {
        try {
            // Agar bu eski socket bo'lsa,
            // yangi socketni offline qilmaymiz.
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

            user.ws = null;
            user.online = false;

            console.log(
                "Foydalanuvchi offline:",
                user.name,
                user.roomCode || "-"
            );

        } catch (error) {
            console.error(
                "Close xatosi:",
                error.message
            );
        }
    });

    // =================================================
    // ERROR
    // =================================================

    ws.on("error", function(error) {
        console.error(
            "WebSocket xatosi:",
            error.message
        );
    });
});

// =====================================================
// WEBSOCKET HEARTBEAT
// =====================================================

const heartbeatInterval = setInterval(
    function() {
        for (const ws of wss.clients) {
            if (ws.isAlive === false) {
                try {
                    ws.terminate();
                } catch (error) {
                    // ignore
                }

                continue;
            }

            ws.isAlive = false;

            try {
                ws.ping();
            } catch (error) {
                // ignore
            }
        }
    },
    30000
);

wss.on("close", function() {
    clearInterval(
        heartbeatInterval
    );
});

// =====================================================
// HEALTH
// =====================================================

app.get("/health", function(req, res) {
    res.json({
        status: "ok",
        database: databaseReady
            ? "connected"
            : "local-mode",
        rooms: rooms.size
    });
});

// =====================================================
// SERVER START
// =====================================================

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
                    "Guruhlar: bazada saqlanadi"
                );

                console.log(
                    "A'zolar: bazada saqlanadi"
                );

                console.log(
                    "Offline joylashuv: saqlanadi"
                );
            } else {
                console.log(
                    "PostgreSQL: ulanmagan"
                );

                console.log(
                    "Lokal rejim: ishlayapti"
                );
            }
        }
    );
}

// =====================================================
// SHUTDOWN
// =====================================================

async function shutdown() {
    try {
        for (const room of rooms.values()) {
            for (const user of room.values()) {
                if (user.online) {
                    user.online = false;
                    user.lastSeen = Date.now();

                    try {
                        await saveMember(user);
                    } catch (error) {
                        console.error(
                            "Member save xatosi:",
                            error.message
                        );
                    }
                }
            }
        }

        if (pool) {
            await pool.end();
        }

        server.close(function() {
            process.exit(0);
        });

    } catch (error) {
        console.error(
            "Shutdown xatosi:",
            error.message
        );

        process.exit(1);
    }
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
