// ============================================================
// LIVE GPS — YANDEX MAPS EDITION
// Backend / server.js ga tegilmaydi
// ============================================================

"use strict";

// ============================================================
// YANDEX MAPS API KEY
// ============================================================
// Yandex Developer Dashboard'dan olingan API keyni shu yerga yozing.
//
// Masalan:
// const YANDEX_API_KEY = "abcdef123456...";
//
// DIQQAT:
// API keyni GitHub'ga ochiq joylashdan oldin HTTP Referer restriction
// qo'yish tavsiya qilinadi.
const YANDEX_API_KEY = "YOUR_YANDEX_API_KEY";


// ============================================================
// CONFIG
// ============================================================

const WS_URL =
    location.protocol === "https:"
        ? `wss://${location.host}`
        : `ws://${location.host}`;


// ============================================================
// STATE
// ============================================================

const state = {
    ws: null,

    userId:
        localStorage.getItem("livegps_user_id") || "",

    userName:
        localStorage.getItem("livegps_user_name") || "",

    roomCode:
        localStorage.getItem("livegps_room_code") || "",

    connected: false,
    connecting: false,
    joining: false,

    reconnectTimer: null,
    reconnectDelay: 1000,

    locationWatchId: null,
    currentPosition: null,

    // Yandex Map
    map: null,
    yandexReady: false,

    // markerlar
    markers: new Map(),

    users: [],

    pendingAction: null,
    pendingRoomCode: null,

    initialized: false,
    invalidRoomCode: "",

    firstLocationCentered: false,

    theme:
        localStorage.getItem("livegps_theme") ||
        "light"
};


// ============================================================
// DOM
// ============================================================

const $ = (id) => document.getElementById(id);


// ============================================================
// HELPERS
// ============================================================

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function saveSession() {
    if (state.userId) {
        localStorage.setItem(
            "livegps_user_id",
            state.userId
        );
    }

    if (state.userName) {
        localStorage.setItem(
            "livegps_user_name",
            state.userName
        );
    }

    if (state.roomCode) {
        localStorage.setItem(
            "livegps_room_code",
            state.roomCode
        );
    }
}


function clearRoomSession() {
    localStorage.removeItem("livegps_room_code");

    state.roomCode = "";
    state.pendingRoomCode = null;
}


function normalizeRoomCode(value) {
    return String(value || "")
        .trim()
        .toUpperCase();
}


function showElement(el, show) {
    if (!el) return;

    el.style.display = show ? "" : "none";
}


function setText(id, text) {
    const el = $(id);

    if (el) {
        el.textContent = text;
    }
}


// ============================================================
// ERROR / STATUS
// ============================================================

function setSetupError(message) {
    const el = $("setupError");

    if (!el) return;

    el.textContent = message || "";
    el.style.display = message ? "block" : "none";
}


function setRoomError(message) {
    const el = $("roomError");

    if (!el) return;

    el.textContent = message || "";
    el.style.display = message ? "block" : "none";
}


function updateConnectionStatus() {
    const pill = $("connectionPill");
    const text = $("connectionText");
    const status = $("connectionStatus");

    if (state.connected) {
        if (pill) {
            pill.classList.remove("offline");
            pill.classList.add("online");
        }

        if (text) {
            text.textContent = "Online";
        }

        if (status) {
            status.textContent = "🟢 Online";
        }

        return;
    }

    if (pill) {
        pill.classList.remove("online");
        pill.classList.add("offline");
    }

    if (text) {
        text.textContent = state.connecting
            ? "Ulanmoqda..."
            : "Offline";
    }

    if (status) {
        status.textContent = state.connecting
            ? "🟡 Ulanmoqda..."
            : "⚪ Offline";
    }
}


// ============================================================
// LOCATION STATUS
// ============================================================

function updateLocationStatus(message) {
    const el = $("locationStatus");

    if (!el) return;

    el.textContent = message || "📍 Joylashuv aniqlanmagan";
}


// ============================================================
// UI
// ============================================================

function showSetup() {
    showElement($("setupCard"), true);
    showElement($("roomCard"), false);
}


function showRoom() {
    showElement($("setupCard"), false);
    showElement($("roomCard"), true);

    setText(
        "currentRoomCode",
        state.roomCode || "—"
    );

    updateConnectionStatus();
    renderMembers();
}


function updateRoomCodeUI() {
    setText(
        "currentRoomCode",
        state.roomCode || "—"
    );
}


// ============================================================
// YANDEX MAPS LOADER
// ============================================================

function loadYandexMaps() {
    return new Promise((resolve, reject) => {
        if (
            typeof ymaps3 !== "undefined"
        ) {
            ymaps3.ready
                .then(() => {
                    state.yandexReady = true;
                    resolve();
                })
                .catch(reject);

            return;
        }

        if (
            !YANDEX_API_KEY ||
            YANDEX_API_KEY === "YOUR_YANDEX_API_KEY"
        ) {
            reject(
                new Error(
                    "Yandex Maps API key kiritilmagan."
                )
            );

            return;
        }

        const existing = document.querySelector(
            'script[data-livegps-yandex="true"]'
        );

        if (existing) {
            existing.addEventListener(
                "load",
                () => {
                    if (
                        typeof ymaps3 ===
                        "undefined"
                    ) {
                        reject(
                            new Error(
                                "Yandex Maps API yuklanmadi."
                            )
                        );

                        return;
                    }

                    ymaps3.ready
                        .then(() => {
                            state.yandexReady = true;
                            resolve();
                        })
                        .catch(reject);
                }
            );

            existing.addEventListener(
                "error",
                () => {
                    reject(
                        new Error(
                            "Yandex Maps API yuklanishida xatolik."
                        )
                    );
                }
            );

            return;
        }

        const script =
            document.createElement("script");

        script.dataset.livegpsYandex = "true";

        script.src =
            `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(
                YANDEX_API_KEY
            )}&lang=uz_UZ`;

        script.async = true;

        script.onload = () => {
            if (
                typeof ymaps3 ===
                "undefined"
            ) {
                reject(
                    new Error(
                        "Yandex Maps API topilmadi."
                    )
                );

                return;
            }

            ymaps3.ready
                .then(() => {
                    state.yandexReady = true;
                    resolve();
                })
                .catch(reject);
        };

        script.onerror = () => {
            reject(
                new Error(
                    "Yandex Maps API yuklanmadi."
                )
            );
        };

        document.head.appendChild(script);
    });
}


// ============================================================
// MAP INIT
// ============================================================

async function initMap() {
    const container = $("map");

    if (!container) {
        return;
    }

    try {
        await loadYandexMaps();

        if (state.map) {
            return;
        }

        const {
            YMap,
            YMapDefaultSchemeLayer,
            YMapDefaultFeaturesLayer
        } = ymaps3;

        // Toshkent boshlang'ich nuqta.
        // GPS aniqlangandan keyin avtomatik o'zgaradi.
        const initialCenter = [
            69.2401,
            41.2995
        ];

        state.map = new YMap(
            container,
            {
                location: {
                    center: initialCenter,
                    zoom: 12
                },

                behaviors: [
                    "drag",
                    "pinchZoom",
                    "dblClick",
                    "mouseTilt"
                ],

                showScaleInCopyrights: true
            }
        );

        // Asosiy Yandex xarita
        state.map.addChild(
            new YMapDefaultSchemeLayer({})
        );

        // Markerlar qatlami
        state.map.addChild(
            new YMapDefaultFeaturesLayer({
                zIndex: 1800
            })
        );

        console.log(
            "YANDEX MAP: ready"
        );

        updateLocationStatus(
            "📍 GPS kutilyapti..."
        );

        renderMarkers();

    } catch (error) {
        console.error(
            "YANDEX MAP ERROR:",
            error
        );

        updateLocationStatus(
            "⚠️ Xarita yuklanmadi"
        );

        const containerText =
            document.createElement("div");

        containerText.className =
            "map-error-message";

        containerText.innerHTML = `
            <div style="
                padding:24px;
                text-align:center;
                font-family:Arial,sans-serif;
            ">
                <div style="
                    font-size:42px;
                    margin-bottom:10px;
                ">🗺️</div>

                <div style="
                    font-weight:700;
                    margin-bottom:8px;
                ">
                    Yandex Maps yuklanmadi
                </div>

                <div style="
                    font-size:13px;
                    opacity:.7;
                ">
                    API keyni tekshiring.
                </div>
            </div>
        `;

        if (
            !container.querySelector(
                ".map-error-message"
            )
        ) {
            container.appendChild(
                containerText
            );
        }
    }
}


// ============================================================
// MAP LOCATION
// ============================================================

function setMapLocation(
    lng,
    lat,
    zoom = 16
) {
    if (!state.map) {
        return;
    }

    if (
        !Number.isFinite(lng) ||
        !Number.isFinite(lat)
    ) {
        return;
    }

    state.map.setLocation({
        center: [lng, lat],
        zoom
    });
}


function centerMapOnUser(
    user,
    zoom = 17
) {
    if (!user) {
        return;
    }

    const lat =
        Number(user.lat);

    const lng =
        Number(user.lng);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return;
    }

    setMapLocation(
        lng,
        lat,
        zoom
    );
}


// ============================================================
// CUSTOM YANDEX MARKER
// ============================================================

function createMarkerElement(
    user,
    isMe
) {
    const wrapper =
        document.createElement("div");

    wrapper.className =
        "livegps-yandex-marker";

    wrapper.style.cssText = `
        position:relative;
        width:54px;
        height:66px;
        cursor:pointer;
        user-select:none;
        transform:translate(-50%,-100%);
        transition:transform .18s ease;
    `;

    const color =
        isMe
            ? "#19d66b"
            : "#3478f6";

    const initials =
        String(user.name || "?")
            .trim()
            .charAt(0)
            .toUpperCase();

    wrapper.innerHTML = `
        <div style="
            position:absolute;
            left:50%;
            top:0;
            transform:translateX(-50%);
            width:48px;
            height:48px;
            border-radius:50%;
            background:${color};
            border:4px solid #fff;
            box-shadow:
                0 4px 18px rgba(0,0,0,.28),
                0 0 0 3px ${color}33;
            display:flex;
            align-items:center;
            justify-content:center;
            color:#fff;
            font-size:17px;
            font-weight:800;
            font-family:Arial,sans-serif;
        ">
            ${escapeHTML(initials)}
        </div>

        <div style="
            position:absolute;
            left:50%;
            top:47px;
            transform:translateX(-50%);
            width:0;
            height:0;
            border-left:9px solid transparent;
            border-right:9px solid transparent;
            border-top:15px solid ${color};
        "></div>

        <div style="
            position:absolute;
            left:50%;
            top:59px;
            transform:translateX(-50%);
            white-space:nowrap;
            background:rgba(20,20,20,.88);
            color:#fff;
            padding:4px 8px;
            border-radius:8px;
            font-size:11px;
            font-weight:700;
            font-family:Arial,sans-serif;
            box-shadow:0 2px 8px rgba(0,0,0,.18);
        ">
            ${escapeHTML(
                isMe
                    ? "Siz"
                    : user.name || "Foydalanuvchi"
            )}
        </div>
    `;

    wrapper.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            centerMapOnUser(
                user,
                18
            );
        }
    );

    wrapper.addEventListener(
        "mouseenter",
        () => {
            wrapper.style.transform =
                "translate(-50%,-100%) scale(1.08)";
        }
    );

    wrapper.addEventListener(
        "mouseleave",
        () => {
            wrapper.style.transform =
                "translate(-50%,-100%) scale(1)";
        }
    );

    return wrapper;
}


// ============================================================
// MARKER UPDATE
// ============================================================

function renderMarkers() {
    if (
        !state.map ||
        typeof ymaps3 ===
        "undefined"
    ) {
        return;
    }

    const {
        YMapMarker
    } = ymaps3;

    const visibleIds =
        new Set();

    for (
        const user of state.users
    ) {
        const lat =
            Number(user.lat);

        const lng =
            Number(user.lng);

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {
            continue;
        }

        const id =
            String(user.id);

        visibleIds.add(id);

        const isMe =
            id === String(state.userId);

        const old =
            state.markers.get(id);

        // Agar marker bor bo'lsa,
        // koordinatasini yangilaymiz.
        if (old) {
            try {
                old.update({
                    coordinates: [
                        lng,
                        lat
                    ]
                });

                const element =
                    old.element;

                if (element) {
                    const newElement =
                        createMarkerElement(
                            user,
                            isMe
                        );

                    old.element =
                        newElement;
                }
            } catch (error) {
                console.warn(
                    "Marker update:",
                    error
                );
            }

            continue;
        }

        const element =
            createMarkerElement(
                user,
                isMe
            );

        const marker =
            new YMapMarker(
                {
                    coordinates: [
                        lng,
                        lat
                    ]
                },
                element
            );

        state.map.addChild(
            marker
        );

        state.markers.set(
            id,
            marker
        );
    }

    // Endi guruhda yo'q markerlarni o'chirish
    for (
        const [id, marker]
        of state.markers
    ) {
        if (
            !visibleIds.has(id)
        ) {
            try {
                state.map.removeChild(
                    marker
                );
            } catch (error) {
                console.warn(
                    "Marker remove:",
                    error
                );
            }

            state.markers.delete(id);
        }
    }
}


// ============================================================
// MY LOCATION
// ============================================================

function centerOnMyLocation() {
    if (
        !state.currentPosition
    ) {
        requestCurrentLocation();
        return;
    }

    const {
        latitude,
        longitude
    } = state.currentPosition.coords;

    setMapLocation(
        longitude,
        latitude,
        18
    );
}


function requestCurrentLocation() {
    if (
        !navigator.geolocation
    ) {
        updateLocationStatus(
            "❌ Brauzer GPSni qo‘llamaydi"
        );

        return;
    }

    updateLocationStatus(
        "📍 Joylashuv aniqlanmoqda..."
    );

    navigator.geolocation.getCurrentPosition(
        (position) => {
            handlePosition(
                position
            );

            centerOnMyLocation();
        },

        (error) => {
            console.warn(
                "GPS ERROR:",
                error
            );

            if (
                error.code ===
                error.PERMISSION_DENIED
            ) {
                updateLocationStatus(
                    "⚠️ GPS ruxsati berilmagan"
                );
            } else if (
                error.code ===
                error.POSITION_UNAVAILABLE
            ) {
                updateLocationStatus(
                    "⚠️ GPS joylashuvni aniqlay olmadi"
                );
            } else {
                updateLocationStatus(
                    "⚠️ GPS aniqlashda xatolik"
                );
            }
        },

        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        }
    );
}


// ============================================================
// GPS POSITION
// ============================================================

function handlePosition(
    position
) {
    if (!position) {
        return;
    }

    state.currentPosition =
        position;

    const coords =
        position.coords;

    const lat =
        Number(coords.latitude);

    const lng =
        Number(coords.longitude);

    const accuracy =
        Number(coords.accuracy);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return;
    }

    const accuracyText =
        Number.isFinite(accuracy)
            ? ` ±${Math.round(
                accuracy
            )} m`
            : "";

    updateLocationStatus(
        `📍 Joylashuv aniqlandi${accuracyText}`
    );

    // Birinchi GPS topilganda
    // xaritani avtomatik markazlaymiz.
    if (
        !state.firstLocationCentered
    ) {
        state.firstLocationCentered =
            true;

        setMapLocation(
            lng,
            lat,
            18
        );
    }

    // Serverga yuborish
    send({
        type: "location",
        lat,
        lng,
        accuracy
    });

    // O'z markerimizni darhol yangilash
    updateOwnUserPosition(
        lat,
        lng
    );
}


function updateOwnUserPosition(
    lat,
    lng
) {
    let found = false;

    state.users =
        state.users.map(
            (user) => {
                if (
                    String(user.id) ===
                    String(state.userId)
                ) {
                    found = true;

                    return {
                        ...user,
                        lat,
                        lng,
                        online: true
                    };
                }

                return user;
            }
        );

    if (!found) {
        state.users.push({
            id: state.userId,
            name: state.userName,
            lat,
            lng,
            online: true
        });
    }

    renderMarkers();
    renderMembers();
}


// ============================================================
// START GPS WATCH
// ============================================================

function startLocation() {
    if (
        !navigator.geolocation
    ) {
        updateLocationStatus(
            "❌ Bu qurilmada GPS mavjud emas"
        );

        return;
    }

    if (
        state.locationWatchId !== null
    ) {
        return;
    }

    updateLocationStatus(
        "📍 GPS aniqlanmoqda..."
    );

    state.locationWatchId =
        navigator.geolocation.watchPosition(
            handlePosition,

            (error) => {
                console.warn(
                    "GPS WATCH ERROR:",
                    error
                );

                if (
                    error.code ===
                    error.PERMISSION_DENIED
                ) {
                    updateLocationStatus(
                        "⚠️ GPS ruxsati berilmagan"
                    );
                } else {
                    updateLocationStatus(
                        "⚠️ GPS signali kutilmoqda..."
                    );
                }
            },

            {
                enableHighAccuracy: true,

                // GPS tez-tez yangilanadi
                maximumAge: 2000,

                // Juda uzoq kutib qolmasin
                timeout: 15000
            }
        );
}


function stopLocation() {
    if (
        state.locationWatchId !== null
    ) {
        navigator.geolocation.clearWatch(
            state.locationWatchId
        );

        state.locationWatchId =
            null;
    }
}


// ============================================================
// WEBSOCKET SEND
// ============================================================

function send(data) {
    if (
        !state.ws ||
        state.ws.readyState !==
        WebSocket.OPEN
    ) {
        return false;
    }

    try {
        state.ws.send(
            JSON.stringify(data)
        );

        return true;
    } catch (error) {
        console.error(
            "WS SEND ERROR:",
            error
        );

        return false;
    }
}


// ============================================================
// WEBSOCKET CONNECT
// ============================================================

function connect() {
    if (
        state.ws &&
        (
            state.ws.readyState ===
            WebSocket.OPEN ||
            state.ws.readyState ===
            WebSocket.CONNECTING
        )
    ) {
        return;
    }

    state.connecting = true;
    updateConnectionStatus();

    let ws;

    try {
        ws = new WebSocket(
            WS_URL
        );
    } catch (error) {
        console.error(
            "WebSocket create error:",
            error
        );

        state.connecting = false;
        updateConnectionStatus();

        scheduleReconnect();

        return;
    }

    state.ws = ws;

    ws.addEventListener(
        "open",
        () => {
            console.log(
                "SERVER: connected"
            );

            state.connected = true;
            state.connecting = false;
            state.reconnectDelay = 1000;

            updateConnectionStatus();

            // Avval foydalanuvchini serverga tanishtirish
            if (
                state.userName
            ) {
                send({
                    type: "identify",
                    name: state.userName,
                    userId: state.userId || undefined
                });
            }

            // Yangi xona yaratish
            if (
                state.pendingAction ===
                "create"
            ) {
                send({
                    type: "create-room",
                    name: state.userName
                });

                state.pendingAction =
                    null;

                return;
            }

            // Xonaga kirish
            if (
                state.pendingAction ===
                "join"
            ) {
                send({
                    type: "join-room",
                    roomCode:
                        state.pendingRoomCode ||
                        state.roomCode,
                    name: state.userName
                });

                state.pendingAction =
                    null;

                return;
            }

            // F5dan keyin saqlangan xonaga kirish
            if (
                state.roomCode &&
                !state.joining
            ) {
                state.joining = true;

                send({
                    type: "join-room",
                    roomCode:
                        state.roomCode,
                    name:
                        state.userName
                });
            }
        }
    );

    ws.addEventListener(
        "message",
        (event) => {
            handleMessage(
                event.data
            );
        }
    );

    ws.addEventListener(
        "close",
        () => {
            console.log(
                "SERVER: disconnected"
            );

            state.connected =
                false;

            state.connecting =
                false;

            state.joining =
                false;

            updateConnectionStatus();

            scheduleReconnect();
        }
    );

    ws.addEventListener(
        "error",
        (error) => {
            console.error(
                "SERVER ERROR:",
                error
            );
        }
    );
}


// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect() {
    if (
        state.reconnectTimer
    ) {
        return;
    }

    state.reconnectTimer =
        setTimeout(
            () => {
                state.reconnectTimer =
                    null;

                connect();

                state.reconnectDelay =
                    Math.min(
                        state.reconnectDelay *
                            2,
                        10000
                    );
            },
            state.reconnectDelay
        );
}


// ============================================================
// SERVER MESSAGE
// ============================================================

function handleMessage(
    raw
) {
    let data;

    try {
        data =
            typeof raw === "string"
                ? JSON.parse(raw)
                : raw;
    } catch (error) {
        console.error(
            "SERVER JSON ERROR:",
            error
        );

        return;
    }

    console.log(
        "SERVER:",
        data
    );

    const type =
        data?.type;

    // --------------------------------------------------------
    // CONNECTED
    // --------------------------------------------------------

    if (
        type === "connected"
    ) {
        if (
            data.userId
        ) {
            state.userId =
                String(
                    data.userId
                );

            saveSession();
        }

        return;
    }


    // --------------------------------------------------------
    // ROOM CREATED
    // --------------------------------------------------------

    if (
        type === "room-created"
    ) {
        state.roomCode =
            normalizeRoomCode(
                data.roomCode
            );

        if (
            data.userId
        ) {
            state.userId =
                String(
                    data.userId
                );
        }

        state.joining =
            false;

        state.firstLocationCentered =
            false;

        saveSession();

        setRoomError("");

        updateRoomCodeUI();
        showRoom();

        startLocation();

        return;
    }


    // --------------------------------------------------------
    // JOINED ROOM
    // --------------------------------------------------------

    if (
        type === "joined-room"
    ) {
        state.roomCode =
            normalizeRoomCode(
                data.roomCode ||
                state.pendingRoomCode ||
                state.roomCode
            );

        if (
            data.userId
        ) {
            state.userId =
                String(
                    data.userId
                );
        }

        state.joining =
            false;

        state.firstLocationCentered =
            false;

        saveSession();

        setRoomError("");

        updateRoomCodeUI();
        showRoom();

        startLocation();

        return;
    }


    // --------------------------------------------------------
    // USERS
    // --------------------------------------------------------

    if (
        type === "users"
    ) {
        state.users =
            Array.isArray(
                data.users
            )
                ? data.users
                : [];

        renderMembers();
        renderMarkers();

        // Agar o'zimizning GPS koordinatamiz
        // allaqachon bor bo'lsa, qayta qo'shamiz.
        if (
            state.currentPosition
        ) {
            const coords =
                state.currentPosition
                    .coords;

            updateOwnUserPosition(
                Number(
                    coords.latitude
                ),
                Number(
                    coords.longitude
                )
            );
        }

        return;
    }


    // --------------------------------------------------------
    // LEFT ROOM
    // --------------------------------------------------------

    if (
        type === "left-room"
    ) {
        stopLocation();

        state.users = [];

        removeAllMarkers();

        clearRoomSession();

        showSetup();

        setSetupError("");

        return;
    }


    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------

    if (
        type === "error"
    ) {
        const message =
            data.message ||
            "Noma'lum xatolik";

        console.error(
            "SERVER ERROR:",
            message
        );

        if (
            state.pendingAction ===
            "create"
        ) {
            setSetupError(
                message
            );
        } else {
            setRoomError(
                message
            );
        }

        // Server "Bunday guruh topilmadi"
        // desa, eski roomni o'chiramiz.
        if (
            /bunday guruh/i.test(
                message
            ) ||
            /guruh topilmadi/i.test(
                message
            ) ||
            /room.*not.*found/i.test(
                message
            )
        ) {
            clearRoomSession();
            state.joining =
                false;

            showSetup();
        }

        return;
    }
}


// ============================================================
// MEMBERS LIST
// ============================================================

function renderMembers() {
    const list =
        $("membersList");

    if (!list) {
        return;
    }

    const users =
        Array.isArray(
            state.users
        )
            ? state.users
            : [];

    setText(
        "membersCount",
        String(users.length)
    );

    if (!users.length) {
        list.innerHTML = `
            <div style="
                padding:20px;
                text-align:center;
                opacity:.65;
            ">
                Guruhda foydalanuvchilar yo‘q
            </div>
        `;

        return;
    }

    list.innerHTML =
        users
            .map(
                (user) => {
                    const isMe =
                        String(
                            user.id
                        ) ===
                        String(
                            state.userId
                        );

                    const online =
                        user.online !==
                        false;

                    const lat =
                        Number(
                            user.lat
                        );

                    const lng =
                        Number(
                            user.lng
                        );

                    const hasLocation =
                        Number.isFinite(
                            lat
                        ) &&
                        Number.isFinite(
                            lng
                        );

                    return `
                        <button
                            type="button"
                            class="member-item"
                            data-user-id="${escapeHTML(
                                user.id
                            )}"
                            style="
                                width:100%;
                                display:flex;
                                align-items:center;
                                gap:12px;
                                padding:12px;
                                border:0;
                                background:transparent;
                                color:inherit;
                                text-align:left;
                                cursor:pointer;
                                border-radius:12px;
                            "
                        >
                            <div style="
                                width:42px;
                                height:42px;
                                flex:0 0 42px;
                                border-radius:50%;
                                display:flex;
                                align-items:center;
                                justify-content:center;
                                background:${
                                    isMe
                                        ? "#19d66b"
                                        : "#3478f6"
                                };
                                color:#fff;
                                font-weight:800;
                            ">
                                ${escapeHTML(
                                    String(
                                        user.name ||
                                        "?"
                                    )
                                        .trim()
                                        .charAt(0)
                                        .toUpperCase()
                                )}
                            </div>

                            <div style="
                                min-width:0;
                                flex:1;
                            ">
                                <div style="
                                    font-weight:700;
                                    overflow:hidden;
                                    text-overflow:ellipsis;
                                    white-space:nowrap;
                                ">
                                    ${escapeHTML(
                                        user.name ||
                                        "Foydalanuvchi"
                                    )}
                                    ${
                                        isMe
                                            ? " (Siz)"
                                            : ""
                                    }
                                </div>

                                <div style="
                                    margin-top:3px;
                                    font-size:12px;
                                    opacity:.7;
                                ">
                                    <span>
                                        ${
                                            online
                                                ? "🟢 Online"
                                                : "⚪ Offline"
                                        }
                                    </span>

                                    ${
                                        hasLocation
                                            ? `
                                                · 📍 Joylashuvi bor
                                            `
                                            : `
                                                · 📍 Joylashuvi yo‘q
                                            `
                                    }
                                </div>
                            </div>

                            ${
                                hasLocation
                                    ? `
                                        <div style="
                                            font-size:18px;
                                        ">
                                            📍
                                        </div>
                                    `
                                    : ""
                            }
                        </button>
                    `;
                }
            )
            .join("");

    list
        .querySelectorAll(
            ".member-item"
        )
        .forEach(
            (button) => {
                button.addEventListener(
                    "click",
                    () => {
                        const id =
                            button.dataset
                                .userId;

                        const user =
                            state.users.find(
                                (item) =>
                                    String(
                                        item.id
                                    ) ===
                                    String(id)
                            );

                        if (
                            user
                        ) {
                            centerMapOnUser(
                                user,
                                18
                            );
                        }
                    }
                );
            }
        );
}


// ============================================================
// REMOVE MARKERS
// ============================================================

function removeAllMarkers() {
    if (!state.map) {
        state.markers.clear();

        return;
    }

    for (
        const marker
        of state.markers.values()
    ) {
        try {
            state.map.removeChild(
                marker
            );
        } catch (error) {
            console.warn(
                "Marker remove:",
                error
            );
        }
    }

    state.markers.clear();
}


// ============================================================
// CREATE ROOM
// ============================================================

function createRoom() {
    const nameInput =
        $("userName");

    const name =
        String(
            nameInput?.value ||
            ""
        ).trim();

    if (!name) {
        setSetupError(
            "Ismingizni kiriting."
        );

        nameInput?.focus();

        return;
    }

    state.userName =
        name;

    state.pendingAction =
        "create";

    state.pendingRoomCode =
        null;

    state.roomCode =
        "";

    localStorage.setItem(
        "livegps_user_name",
        state.userName
    );

    setSetupError("");

    connect();

    if (
        state.connected
    ) {
        send({
            type: "create-room",
            name: state.userName
        });

        state.pendingAction =
            null;
    }
}


// ============================================================
// JOIN ROOM
// ============================================================

function joinRoom(
    roomCodeFromInput
) {
    const nameInput =
        $("userName");

    const roomInput =
        $("roomCode");

    const name =
        String(
            nameInput?.value ||
            state.userName ||
            ""
        ).trim();

    const roomCode =
        normalizeRoomCode(
            roomCodeFromInput ??
            roomInput?.value
        );

    if (!name) {
        setSetupError(
            "Avval ismingizni kiriting."
        );

        nameInput?.focus();

        return;
    }

    if (!roomCode) {
        setSetupError(
            "Guruh kodini kiriting."
        );

        roomInput?.focus();

        return;
    }

    state.userName =
        name;

    state.pendingAction =
        "join";

    state.pendingRoomCode =
        roomCode;

    state.roomCode =
        roomCode;

    state.joining =
        true;

    localStorage.setItem(
        "livegps_user_name",
        state.userName
    );

    localStorage.setItem(
        "livegps_room_code",
        roomCode
    );

    setSetupError("");

    connect();

    if (
        state.connected
    ) {
        send({
            type: "join-room",
            roomCode,
            name: state.userName
        });

        state.pendingAction =
            null;
    }
}


// ============================================================
// SWITCH ROOM
// ============================================================

function switchRoom() {
    const input =
        $("switchRoomInput");

    const roomCode =
        normalizeRoomCode(
            input?.value
        );

    if (!roomCode) {
        setRoomError(
            "Yangi guruh kodini kiriting."
        );

        return;
    }

    state.pendingAction =
        "join";

    state.pendingRoomCode =
        roomCode;

    state.roomCode =
        roomCode;

    state.joining =
        true;

    saveSession();

    setRoomError("");

    if (
        state.ws &&
        state.ws.readyState ===
        WebSocket.OPEN
    ) {
        send({
            type: "join-room",
            roomCode,
            name: state.userName
        });

        state.pendingAction =
            null;
    } else {
        connect();
    }
}


// ============================================================
// LEAVE ROOM
// ============================================================

function leaveRoom() {
    const confirmed =
        window.confirm(
            "Guruhdan chiqishni xohlaysizmi?"
        );

    if (!confirmed) {
        return;
    }

    send({
        type: "leave-room"
    });

    stopLocation();

    state.users = [];

    removeAllMarkers();

    clearRoomSession();

    state.firstLocationCentered =
        false;

    showSetup();

    setRoomError("");

    setSetupError("");

    updateLocationStatus(
        "📍 Joylashuv aniqlanmagan"
    );
}


// ============================================================
// COPY ROOM CODE
// ============================================================

async function copyRoomCode() {
    const code =
        state.roomCode;

    if (!code) {
        return;
    }

    try {
        await navigator.clipboard.writeText(
            code
        );

        setText(
            "copyRoomText",
            "Nusxalandi!"
        );

        setTimeout(
            () => {
                setText(
                    "copyRoomText",
                    "Nusxalash"
                );
            },
            1800
        );

    } catch (error) {
        console.warn(
            "Clipboard error:",
            error
        );

        // Eski brauzerlar uchun fallback
        const area =
            document.createElement(
                "textarea"
            );

        area.value =
            code;

        document.body.appendChild(
            area
        );

        area.select();

        try {
            document.execCommand(
                "copy"
            );
        } catch (_) {}

        area.remove();

        setText(
            "copyRoomText",
            "Nusxalandi!"
        );

        setTimeout(
            () => {
                setText(
                    "copyRoomText",
                    "Nusxalash"
                );
            },
            1800
        );
    }
}


// ============================================================
// THEME
// ============================================================

function applyTheme() {
    const isDark =
        state.theme === "dark";

    document.documentElement
        .classList.toggle(
            "dark",
            isDark
        );

    document.body
        .classList.toggle(
            "dark",
            isDark
        );

    const icon =
        $("themeIcon");

    if (icon) {
        icon.textContent =
            isDark
                ? "☀️"
                : "🌙";
    }

    localStorage.setItem(
        "livegps_theme",
        state.theme
    );
}


function toggleTheme() {
    state.theme =
        state.theme === "dark"
            ? "light"
            : "dark";

    applyTheme();
}


// ============================================================
// EVENTS
// ============================================================

function setupEvents() {
    const createBtn =
        $("createRoomBtn");

    if (createBtn) {
        createBtn.addEventListener(
            "click",
            createRoom
        );
    }


    const joinBtn =
        $("joinRoomBtn");

    if (joinBtn) {
        joinBtn.addEventListener(
            "click",
            () => {
                joinRoom();
            }
        );
    }


    const roomInput =
        $("roomCode");

    if (roomInput) {
        roomInput.addEventListener(
            "keydown",
            (event) => {
                if (
                    event.key ===
                    "Enter"
                ) {
                    joinRoom();
                }
            }
        );
    }


    const nameInput =
        $("userName");

    if (nameInput) {
        nameInput.addEventListener(
            "keydown",
            (event) => {
                if (
                    event.key ===
                    "Enter"
                ) {
                    joinRoom();
                }
            }
        );
    }


    const copyBtn =
        $("copyRoomBtn");

    if (copyBtn) {
        copyBtn.addEventListener(
            "click",
            copyRoomCode
        );
    }


    const myLocationBtn =
        $("myLocationBtn");

    if (myLocationBtn) {
        myLocationBtn.addEventListener(
            "click",
            centerOnMyLocation
        );
    }


    const centerMapBtn =
        $("centerMapBtn");

    if (centerMapBtn) {
        centerMapBtn.addEventListener(
            "click",
            centerOnMyLocation
        );
    }


    const switchBtn =
        $("switchRoomBtn");

    if (switchBtn) {
        switchBtn.addEventListener(
            "click",
            switchRoom
        );
    }


    const switchInput =
        $("switchRoomInput");

    if (switchInput) {
        switchInput.addEventListener(
            "keydown",
            (event) => {
                if (
                    event.key ===
                    "Enter"
                ) {
                    switchRoom();
                }
            }
        );
    }


    const themeBtn =
        $("themeBtn");

    if (themeBtn) {
        themeBtn.addEventListener(
            "click",
            toggleTheme
        );
    }


    // HTML ichida inline onclick bo'lsa ham ishlashi uchun
    window.leaveRoom =
        leaveRoom;

    window.createRoom =
        createRoom;

    window.joinRoom =
        joinRoom;

    window.switchRoom =
        switchRoom;

    window.copyRoomCode =
        copyRoomCode;

    window.centerOnMyLocation =
        centerOnMyLocation;

    window.toggleTheme =
        toggleTheme;
}


// ============================================================
// RESTORE SESSION
// ============================================================

function restoreSession() {
    const savedName =
        localStorage.getItem(
            "livegps_user_name"
        );

    const savedRoom =
        localStorage.getItem(
            "livegps_room_code"
        );

    if (savedName) {
        state.userName =
            savedName;

        const input =
            $("userName");

        if (input) {
            input.value =
                savedName;
        }
    }

    if (savedRoom) {
        state.roomCode =
            normalizeRoomCode(
                savedRoom
            );
    }
}


// ============================================================
// INIT
// ============================================================

async function init() {
    if (
        state.initialized
    ) {
        return;
    }

    state.initialized =
        true;

    applyTheme();

    restoreSession();

    setupEvents();

    // Xarita parallel ravishda yuklanadi
    initMap();

    updateConnectionStatus();

    if (
        state.userName &&
        state.roomCode
    ) {
        showRoom();

        updateRoomCodeUI();

        // F5dan keyin serverga ulanamiz
        connect();

    } else {
        showSetup();
    }
}


// ============================================================
// PAGE READY
// ============================================================

if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        init
    );
} else {
    init();
}


// ============================================================
// PAGE CLOSE
// ============================================================

window.addEventListener(
    "beforeunload",
    () => {
        // Server sessionni localStorage'da saqlab qolamiz.
        // F5dan keyin qayta ulanadi.
        stopLocation();
    }
);
