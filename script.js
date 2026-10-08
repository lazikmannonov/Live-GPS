
"use strict";

/* =========================================================
   LIVE GPS — YANDEX MAPS 3.0
   server.js ga tegilmaydi
   ========================================================= */


/* =========================================================
   WEBSOCKET URL
========================================================= */

const WS_URL =
    location.protocol === "https:"
        ? `wss://${location.host}`
        : `ws://${location.host}`;


/* =========================================================
   STATE
========================================================= */

const state = {

    ws: null,

    userId:
        localStorage.getItem("livegps_user_id") ||
        `user_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,

    userName:
        localStorage.getItem("livegps_user_name") || "",

    roomCode:
        localStorage.getItem("livegps_room_code") || "",

    connected: false,

    reconnectTimer: null,
    reconnectAttempts: 0,

    pendingAction: null,

    gpsWatchId: null,

    currentPosition: null,

    /* Eng so‘nggi yaxshi GPS nuqta */
    lastGoodPosition: null,

    map: null,

    yandexReady: false,
    mapReady: false,

    markers: new Map(),
    users: new Map(),

    firstGpsFix: false,

    theme:
        localStorage.getItem("livegps_theme") || "dark"
};


/* =========================================================
   SAVE USER ID
========================================================= */

localStorage.setItem(
    "livegps_user_id",
    state.userId
);


/* =========================================================
   DOM HELPERS
========================================================= */

function $(id) {
    return document.getElementById(id);
}


function setText(id, value) {

    const el = $(id);

    if (el) {
        el.textContent = value;
    }
}


/* =========================================================
   SHOW / HIDE
========================================================= */

function showElement(id, show) {

    const el = $(id);

    if (!el) {
        return;
    }

    if (show) {

        el.classList.remove("hidden");
        el.style.display = "";

    } else {

        el.classList.add("hidden");
        el.style.display = "none";
    }
}


/* =========================================================
   SHOW SETUP
========================================================= */

function showSetup() {

    showElement("setupCard", true);
    showElement("roomCard", false);

    setRoomError("");
    setSetupError("");
}


/* =========================================================
   SHOW ROOM
========================================================= */

function showRoom() {

    showElement("setupCard", false);
    showElement("roomCard", true);

    requestAnimationFrame(() => {
        updateRoomCodeUI();
    });
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHTML(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================================================
   ROOM CODE
========================================================= */

function normalizeRoomCode(value) {

    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "");
}


/* =========================================================
   ERRORS
========================================================= */

function setSetupError(message = "") {

    const el = $("setupError");

    if (!el) {
        return;
    }

    el.textContent = message;

    el.style.display =
        message ? "block" : "none";
}


function setRoomError(message = "") {

    const el = $("roomError");

    if (!el) {
        return;
    }

    el.textContent = message;

    el.style.display =
        message ? "block" : "none";
}


/* =========================================================
   SESSION
========================================================= */

function saveSession() {

    localStorage.setItem(
        "livegps_user_id",
        state.userId
    );

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

    state.roomCode = "";

    localStorage.removeItem(
        "livegps_room_code"
    );
}


/* =========================================================
   ROOM CODE UI
========================================================= */

function updateRoomCodeUI() {

    const el = $("currentRoomCode");

    if (!el) {
        return;
    }

    const code =
        normalizeRoomCode(
            state.roomCode
        );

    el.textContent =
        code || "------";

    el.style.display = "block";
    el.style.visibility = "visible";
    el.style.opacity = "1";
}


/* =========================================================
   CONNECTION STATUS
========================================================= */

function updateConnectionStatus(
    status,
    text
) {

    setText(
        "connectionText",
        text
    );

    const pill =
        $("connectionPill");

    if (pill) {

        pill.classList.remove(
            "online",
            "offline",
            "connecting"
        );

        pill.classList.add(status);
    }

    const statusEl =
        $("connectionStatus");

    if (statusEl) {
        statusEl.textContent = text;
    }
}


/* =========================================================
   LOCATION STATUS
========================================================= */

function updateLocationStatus(
    status,
    text
) {

    const el =
        $("locationStatus");

    if (!el) {
        return;
    }

    el.textContent = text;

    el.classList.remove(
        "active",
        "error",
        "waiting"
    );

    if (status) {
        el.classList.add(status);
    }
}


/* =========================================================
   YANDEX MAP LOADER
========================================================= */

async function loadYandexMaps() {

    try {

        const maxWait = 15000;
        const interval = 100;
        const startTime = Date.now();

        while (
            typeof ymaps3 === "undefined" &&
            Date.now() - startTime < maxWait
        ) {

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        interval
                    )
            );
        }

        if (
            typeof ymaps3 === "undefined"
        ) {

            throw new Error(
                "Yandex Maps API yuklanmadi."
            );
        }

        await ymaps3.ready;

        state.yandexReady = true;

        console.log(
            "YANDEX MAPS: ready"
        );

        return true;

    } catch (error) {

        state.yandexReady = false;

        console.error(
            "YANDEX MAPS ERROR:",
            error
        );

        throw error;
    }
}


/* =========================================================
   INIT MAP
========================================================= */

async function initMap() {

    try {

        await loadYandexMaps();

        if (state.map) {
            return;
        }

        const mapContainer =
            $("map");

        if (!mapContainer) {

            throw new Error(
                "Map container topilmadi."
            );
        }

        const {
            YMap,
            YMapDefaultSchemeLayer,
            YMapDefaultFeaturesLayer
        } = ymaps3;


        state.map =
            new YMap(
                mapContainer,
                {
                    location: {
                        center: [
                            69.2401,
                            41.2995
                        ],
                        zoom: 12
                    },

                    behaviors: [
                        "drag",
                        "pinchZoom",
                        "dblClick",
                        "mouseTilt"
                    ]
                }
            );


        state.map.addChild(
            new YMapDefaultSchemeLayer()
        );


        state.map.addChild(
            new YMapDefaultFeaturesLayer()
        );


        state.mapReady = true;

        console.log(
            "YANDEX MAP: initialized"
        );


        if (state.currentPosition) {

            centerMap(
                state.currentPosition.lng,
                state.currentPosition.lat,
                17
            );
        }


        renderMarkers();

    } catch (error) {

        state.mapReady = false;

        console.error(
            "YANDEX MAP ERROR:",
            error
        );

        setRoomError(
            "Xarita yuklanmadi. Yandex API key sozlamasini tekshiring."
        );
    }
}


/* =========================================================
   CENTER MAP
========================================================= */

function centerMap(
    lng,
    lat,
    zoom = 17
) {

    if (!state.map) {
        return;
    }

    const safeLng = Number(lng);
    const safeLat = Number(lat);

    if (
        !Number.isFinite(safeLng) ||
        !Number.isFinite(safeLat)
    ) {
        return;
    }

    try {

        state.map.setLocation({
            center: [
                safeLng,
                safeLat
            ],
            zoom
        });

    } catch (error) {

        console.error(
            "MAP CENTER ERROR:",
            error
        );
    }
}


/* =========================================================
   CREATE MARKER
========================================================= */

function createMarkerElement(user) {

    const wrapper =
        document.createElement("div");

    wrapper.className =
        "gps-marker";

    wrapper.style.pointerEvents =
        "auto";

    wrapper.style.cursor =
        "pointer";


    wrapper.addEventListener(
        "click",
        event => {

            event.stopPropagation();

            const id =
                user.id ||
                user.userId;

            centerSelectedUser(id);
        }
    );


    const isMe =
        String(
            user.id ||
            user.userId
        ) ===
        String(state.userId);


    if (isMe) {
        wrapper.classList.add("me");
    } else {
        wrapper.classList.add("other");
    }


    const pin =
        document.createElement("div");

    pin.className =
        "gps-marker-pin";


    const dot =
        document.createElement("div");

    dot.className =
        "gps-marker-dot";


    pin.appendChild(dot);


    const label =
        document.createElement("div");

    label.className =
        "gps-marker-label";

    label.textContent =
        user.name ||
        user.userName ||
        "Foydalanuvchi";


    wrapper.appendChild(pin);
    wrapper.appendChild(label);


    return wrapper;
}


/* =========================================================
   REMOVE MARKER
========================================================= */

function removeMarker(userId) {

    const marker =
        state.markers.get(
            String(userId)
        );

    if (
        !marker ||
        !state.map
    ) {
        return;
    }

    try {

        state.map.removeChild(
            marker
        );

    } catch (error) {

        console.warn(
            "Marker remove error:",
            error
        );
    }

    state.markers.delete(
        String(userId)
    );
}


/* =========================================================
   RENDER MARKERS
========================================================= */

function renderMarkers() {

    if (
        !state.mapReady ||
        !state.map ||
        typeof ymaps3 === "undefined"
    ) {
        return;
    }

    const {
        YMapMarker
    } = ymaps3;


    const activeIds =
        new Set();


    state.users.forEach(
        (user, userId) => {

            if (
                user.lat === undefined ||
                user.lng === undefined ||
                user.lat === null ||
                user.lng === null
            ) {
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


            /*
             * Noto‘g‘ri geografik qiymatni
             * umuman markerga aylantirmaymiz.
             */

            if (
                Math.abs(lat) > 90 ||
                Math.abs(lng) > 180
            ) {
                return;
            }


            const id =
                String(userId);

            activeIds.add(id);


            if (
                state.markers.has(id)
            ) {

                removeMarker(id);
            }


            const element =
                createMarkerElement(
                    user
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
    );


    state.markers.forEach(
        (_, userId) => {

            if (
                !activeIds.has(
                    String(userId)
                )
            ) {

                removeMarker(
                    userId
                );
            }
        }
    );
}


/* =========================================================
   CENTER MY LOCATION
========================================================= */

function centerMyLocation() {

    if (!state.currentPosition) {

        updateLocationStatus(
            "waiting",
            "Joylashuv hali aniqlanmadi"
        );

        return;
    }


    centerMap(
        state.currentPosition.lng,
        state.currentPosition.lat,
        18
    );
}


/* =========================================================
   CENTER SELECTED USER
========================================================= */

function centerSelectedUser(userId) {

    const id =
        String(userId);

    const user =
        state.users.get(id);


    if (!user) {

        console.warn(
            "Foydalanuvchi topilmadi:",
            id
        );

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

        updateLocationStatus(
            "waiting",
            "Bu foydalanuvchining joylashuvi mavjud emas"
        );

        return;
    }


    centerMap(
        lng,
        lat,
        18
    );


    const marker =
        state.markers.get(id);


    if (marker) {

        const element =
            marker.element;

        if (element) {

            element.classList.add(
                "selected"
            );

            setTimeout(
                () => {

                    element.classList.remove(
                        "selected"
                    );

                },
                1200
            );
        }
    }


    console.log(
        "SELECTED USER LOCATION:",
        user.name ||
        user.userName,
        lat,
        lng
    );
}


/* =========================================================
   CENTER ALL USERS
========================================================= */

function centerAllUsers() {

    const positions = [];


    state.users.forEach(
        user => {

            const lat =
                Number(user.lat);

            const lng =
                Number(user.lng);


            if (
                Number.isFinite(lat) &&
                Number.isFinite(lng) &&
                Math.abs(lat) <= 90 &&
                Math.abs(lng) <= 180
            ) {

                positions.push([
                    lng,
                    lat
                ]);
            }
        }
    );


    if (!positions.length) {

        centerMyLocation();

        return;
    }


    if (positions.length === 1) {

        centerMap(
            positions[0][0],
            positions[0][1],
            17
        );

        return;
    }


    const lngs =
        positions.map(
            p => p[0]
        );

    const lats =
        positions.map(
            p => p[1]
        );


    const minLng =
        Math.min(...lngs);

    const maxLng =
        Math.max(...lngs);

    const minLat =
        Math.min(...lats);

    const maxLat =
        Math.max(...lats);


    const centerLng =
        (minLng + maxLng) / 2;

    const centerLat =
        (minLat + maxLat) / 2;


    let zoom = 14;


    const spread =
        Math.max(
            maxLng - minLng,
            maxLat - minLat
        );


    if (spread < 0.001) {

        zoom = 17;

    } else if (spread < 0.005) {

        zoom = 15;

    } else if (spread < 0.02) {

        zoom = 13;

    } else if (spread < 0.1) {

        zoom = 11;

    } else {

        zoom = 9;
    }


    centerMap(
        centerLng,
        centerLat,
        zoom
    );
}


/* =========================================================
   MEMBERS UI
========================================================= */

function updateMembersUI() {

    const users =
        Array.from(
            state.users.values()
        );


    setText(
        "membersCount",
        String(users.length)
    );


    const list =
        $("membersList");


    if (!list) {
        return;
    }


    if (!users.length) {

        list.innerHTML =
            `<div class="empty-members">
                Hozircha foydalanuvchilar yo‘q
            </div>`;

        return;
    }


    list.innerHTML =
        users
            .map(user => {

                const name =
                    escapeHTML(
                        user.name ||
                        user.userName ||
                        "Foydalanuvchi"
                    );


                const id =
                    String(
                        user.id ||
                        user.userId
                    );


                const isMe =
                    id ===
                    String(state.userId);


                const lat =
                    Number(user.lat);

                const lng =
                    Number(user.lng);


                const hasLocation =
                    Number.isFinite(lat) &&
                    Number.isFinite(lng) &&
                    Math.abs(lat) <= 90 &&
                    Math.abs(lng) <= 180;


                return `
                    <div
                        class="member-item"
                        data-user-id="${escapeHTML(id)}"
                        ${
                            hasLocation
                                ? 'role="button" tabindex="0"'
                                : ''
                        }
                        ${
                            hasLocation
                                ? 'title="Xaritada joylashuvini ko‘rsatish"'
                                : ''
                        }
                    >

                        <div class="member-avatar">
                            ${name
                                .charAt(0)
                                .toUpperCase()}
                        </div>

                        <div class="member-info">

                            <div class="member-name">
                                ${name}
                                ${
                                    isMe
                                        ? " <span>(siz)</span>"
                                        : ""
                                }
                            </div>

                            <div class="member-status">
                                ${
                                    hasLocation
                                        ? "● Online"
                                        : "○ Joylashuv yo‘q"
                                }
                            </div>

                        </div>

                        ${
                            hasLocation
                                ? `<div class="member-map-arrow">⌖</div>`
                                : ""
                        }

                    </div>
                `;
            })
            .join("");


    list
        .querySelectorAll(
            ".member-item[data-user-id]"
        )
        .forEach(item => {

            const userId =
                item.dataset.userId;


            item.addEventListener(
                "click",
                () => {

                    centerSelectedUser(
                        userId
                    );
                }
            );


            item.addEventListener(
                "keydown",
                event => {

                    if (
                        event.key === "Enter" ||
                        event.key === " "
                    ) {

                        event.preventDefault();

                        centerSelectedUser(
                            userId
                        );
                    }
                }
            );
        });
}


/* =========================================================
   GPS DISTANCE
   ========================================================= */

function getDistanceMeters(
    lat1,
    lng1,
    lat2,
    lng2
) {

    const R = 6371000;

    const toRad =
        value =>
            value * Math.PI / 180;


    const dLat =
        toRad(lat2 - lat1);

    const dLng =
        toRad(lng2 - lng1);


    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;


    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );


    return R * c;
}


/* =========================================================
   GPS POSITION QUALITY
========================================================= */

function isGoodGPSPosition(
    lat,
    lng,
    accuracy
) {

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return false;
    }


    if (
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
    ) {
        return false;
    }


    /*
     * Juda yomon aniqlik.
     * Bunday nuqtani xaritaga qo‘ymaymiz.
     */

    if (
        Number.isFinite(accuracy) &&
        accuracy > 500
    ) {

        console.warn(
            "GPS: juda noaniq nuqta:",
            accuracy,
            "m"
        );

        return false;
    }


    /*
     * Oldingi yaxshi nuqtadan birdaniga
     * juda uzoqqa sakrashni tekshiramiz.
     */

    if (state.lastGoodPosition) {

        const previous =
            state.lastGoodPosition;


        const distance =
            getDistanceMeters(
                previous.lat,
                previous.lng,
                lat,
                lng
            );


        /*
         * Telefon GPS aniqligi yomon bo‘lsa,
         * kichik sakrashlarni ham qabul qilmaymiz.
         */

        const allowedJump =
            Math.max(
                1000,
                (Number(previous.accuracy) || 50) * 4,
                (Number(accuracy) || 50) * 4
            );


        if (
            distance > allowedJump
        ) {

            console.warn(
                "GPS: noto‘g‘ri sakrash filtrlandi:",
                Math.round(distance),
                "m"
            );

            updateLocationStatus(
                "waiting",
                `GPS aniqlashtirilmoqda... ±${Math.round(
                    accuracy
                )} m`
            );

            return false;
        }
    }


    return true;
}


/* =========================================================
   GPS START
========================================================= */

function startLocationTracking() {

    if (!navigator.geolocation) {

        updateLocationStatus(
            "error",
            "Brauzeringiz GPSni qo‘llab-quvvatlamaydi"
        );

        return;
    }


    if (
        state.gpsWatchId !== null
    ) {
        return;
    }


    state.firstGpsFix = false;


    updateLocationStatus(
        "waiting",
        "GPS aniqlanmoqda..."
    );


    state.gpsWatchId =
        navigator.geolocation.watchPosition(
            handlePosition,
            handleLocationError,
            {
                /*
                 * Telefonning haqiqiy GPS chipidan
                 * foydalanishga ustuvorlik beramiz.
                 */

                enableHighAccuracy: true,

                /*
                 * Eski cache koordinatani ishlatmaymiz.
                 */

                maximumAge: 0,

                /*
                 * GPSga ko‘proq vaqt beramiz.
                 */

                timeout: 30000
            }
        );
}


/* =========================================================
   GPS STOP
========================================================= */

function stopLocationTracking() {

    if (
        state.gpsWatchId !== null &&
        navigator.geolocation
    ) {

        navigator.geolocation.clearWatch(
            state.gpsWatchId
        );

        state.gpsWatchId = null;
    }
}


/* =========================================================
   GPS POSITION
========================================================= */

function handlePosition(position) {

    const lat =
        Number(
            position.coords.latitude
        );


    const lng =
        Number(
            position.coords.longitude
        );


    const accuracy =
        Number(
            position.coords.accuracy
        );


    /*
     * Birinchi navbatda koordinatani tekshiramiz.
     */

    if (
        !isGoodGPSPosition(
            lat,
            lng,
            accuracy
        )
    ) {

        return;
    }


    /*
     * Yaxshi GPS nuqta saqlanadi.
     */

    state.lastGoodPosition = {
        lat,
        lng,
        accuracy
    };


    state.currentPosition = {
        lat,
        lng,
        accuracy
    };


    let accuracyText =
        "Aniqlandi";


    if (
        Number.isFinite(accuracy)
    ) {

        accuracyText =
            `±${Math.round(
                accuracy
            )} m`;
    }


    updateLocationStatus(
        "active",
        `Joylashuv aniqlandi ${accuracyText}`
    );


    /*
     * Faqat yaxshi aniqlikdagi
     * birinchi nuqtada xaritani markazlaymiz.
     */

    if (
        state.mapReady &&
        !state.firstGpsFix
    ) {

        /*
         * 200 metrdan yomon bo‘lsa,
         * xaritani hali sakratmaymiz.
         */

        if (
            !Number.isFinite(accuracy) ||
            accuracy <= 200
        ) {

            centerMap(
                lng,
                lat,
                18
            );

            state.firstGpsFix = true;
        }
    }


    /*
     * O‘z foydalanuvchimizni yangilaymiz.
     */

    const currentUser =
        state.users.get(
            String(state.userId)
        ) || {

            id:
                state.userId,

            userId:
                state.userId,

            name:
                state.userName
        };


    currentUser.id =
        currentUser.id ||
        state.userId;


    currentUser.userId =
        currentUser.userId ||
        state.userId;


    currentUser.name =
        currentUser.name ||
        state.userName;


    currentUser.lat =
        lat;

    currentUser.lng =
        lng;

    currentUser.accuracy =
        accuracy;


    state.users.set(
        String(state.userId),
        currentUser
    );


    updateMembersUI();

    renderMarkers();


    sendLocation(
        lat,
        lng,
        accuracy
    );
}


/* =========================================================
   GPS ERROR
========================================================= */

function handleLocationError(error) {

    console.error(
        "GPS ERROR:",
        error
    );


    let message =
        "Joylashuvni aniqlab bo‘lmadi";


    if (error.code === 1) {

        message =
            "GPS uchun ruxsat berilmagan";

    } else if (error.code === 2) {

        message =
            "Joylashuv aniqlanmadi";

    } else if (error.code === 3) {

        message =
            "GPS so‘rovi vaqt tugadi";
    }


    updateLocationStatus(
        "error",
        message
    );
}


/* =========================================================
   WEBSOCKET SEND
========================================================= */

function sendMessage(payload) {

    if (
        !state.ws ||
        state.ws.readyState !==
            WebSocket.OPEN
    ) {
        return false;
    }


    try {

        state.ws.send(
            JSON.stringify(
                payload
            )
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


/* =========================================================
   SEND LOCATION
========================================================= */

function sendLocation(
    lat,
    lng,
    accuracy
) {

    sendMessage({

        type:
            "location",

        lat,

        lng,

        accuracy
    });
}


/* =========================================================
   CONNECT WEBSOCKET
========================================================= */

function connectWebSocket() {

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


    updateConnectionStatus(
        "connecting",
        "Ulanmoqda..."
    );


    try {

        state.ws =
            new WebSocket(
                WS_URL
            );

    } catch (error) {

        console.error(
            "WEBSOCKET CREATE ERROR:",
            error
        );

        scheduleReconnect();

        return;
    }


    state.ws.onopen = () => {

        console.log(
            "SERVER: connected"
        );


        state.connected =
            true;

        state.reconnectAttempts =
            0;


        updateConnectionStatus(
            "online",
            "Ulangan"
        );


        sendMessage({

            type:
                "identify",

            userId:
                state.userId,

            name:
                state.userName
        });


        /*
         * Tugma bosilganda server hali ulanmagan
         * bo‘lsa, saqlangan amalni shu yerda yuboramiz.
         */

        if (
            state.pendingAction ===
            "create"
        ) {

            state.pendingAction =
                null;

            sendMessage({

                type:
                    "create-room",

                name:
                    state.userName,

                userId:
                    state.userId
            });

            return;
        }


        if (
            state.pendingAction ===
            "join"
        ) {

            state.pendingAction =
                null;

            sendMessage({

                type:
                    "join-room",

                roomCode:
                    state.roomCode,

                name:
                    state.userName,

                userId:
                    state.userId
            });

            return;
        }


        if (state.roomCode) {

            sendMessage({

                type:
                    "join-room",

                roomCode:
                    state.roomCode
            });
        }
    };


    state.ws.onmessage =
        event => {

            handleServerMessage(
                event.data
            );
        };


    state.ws.onerror =
        error => {

            console.error(
                "SERVER ERROR:",
                error
            );
        };


    state.ws.onclose = () => {

        console.log(
            "SERVER: disconnected"
        );


        state.connected =
            false;


        updateConnectionStatus(
            "offline",
            "Ulanish uzildi"
        );


        scheduleReconnect();
    };
}


/* =========================================================
   RECONNECT
========================================================= */

function scheduleReconnect() {

    if (state.reconnectTimer) {
        return;
    }


    state.reconnectAttempts++;


    const delay =
        Math.min(
            1000 *
                Math.pow(
                    1.5,
                    Math.min(
                        state.reconnectAttempts,
                        8
                    )
                ),
            15000
        );


    state.reconnectTimer =
        setTimeout(
            () => {

                state.reconnectTimer =
                    null;

                connectWebSocket();

            },
            delay
        );
}


/* =========================================================
   SERVER MESSAGE
========================================================= */

function handleServerMessage(raw) {

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
        data.type ||
        data.event;


    switch (type) {

        case "connected":
            break;


        case "room-created":

            handleRoomCreated(
                data
            );

            break;


        case "joined-room":

            handleJoinedRoom(
                data
            );

            break;


        case "users":

            handleUsers(
                data
            );

            break;


        case "left-room":

            handleLeftRoom(
                data
            );

            break;


        case "error":

            handleServerError(
                data
            );

            break;


        default:

            console.log(
                "UNKNOWN SERVER MESSAGE:",
                data
            );
    }
}


/* =========================================================
   ROOM CREATED
========================================================= */

function handleRoomCreated(data) {

    console.log(
        "ROOM CREATED:",
        data
    );


    const room =
        normalizeRoomCode(
            data.roomCode ||
            data.code ||
            data.room
        );


    if (!room) {

        setSetupError(
            "Guruh kodi serverdan olinmadi."
        );

        return;
    }


    state.roomCode =
        room;


    saveSession();


    showRoom();

    updateRoomCodeUI();


    requestAnimationFrame(
        () => {
            updateRoomCodeUI();
        }
    );


    setRoomError("");


    startLocationTracking();
}


/* =========================================================
   JOINED ROOM
========================================================= */

function handleJoinedRoom(data) {

    const room =
        normalizeRoomCode(
            data.roomCode ||
            data.code ||
            data.room ||
            state.roomCode
        );


    if (room) {

        state.roomCode =
            room;

        saveSession();
    }


    showRoom();

    updateRoomCodeUI();

    setRoomError("");


    console.log(
        "joined-room",
        data
    );


    startLocationTracking();
}


/* =========================================================
   USERS
========================================================= */

function handleUsers(data) {

    const list =
        Array.isArray(
            data.users
        )
            ? data.users
            : [];


    state.users.clear();


    list.forEach(
        user => {

            const id =
                user.id ||
                user.userId;


            if (!id) {
                return;
            }


            const safeId =
                String(id);


            const lat =
                Number(user.lat);

            const lng =
                Number(user.lng);


            /*
             * Faqat haqiqiy koordinatalarni
             * guruh xaritasiga qo‘shamiz.
             */

            const cleanUser = {
                ...user,

                id:
                    safeId,

                userId:
                    String(
                        user.userId ||
                        id
                    )
            };


            if (
                Number.isFinite(lat) &&
                Number.isFinite(lng) &&
                Math.abs(lat) <= 90 &&
                Math.abs(lng) <= 180
            ) {

                cleanUser.lat = lat;
                cleanUser.lng = lng;

                if (
                    Number.isFinite(
                        Number(user.accuracy)
                    )
                ) {

                    cleanUser.accuracy =
                        Number(
                            user.accuracy
                        );
                }

            } else {

                /*
                 * Noto‘g‘ri koordinatani
                 * markerga chiqarmaymiz.
                 */

                delete cleanUser.lat;
                delete cleanUser.lng;
            }


            state.users.set(
                safeId,
                cleanUser
            );
        }
    );


    /*
     * Server o‘zimizni qaytarmagan bo‘lsa,
     * lokal GPSni saqlaymiz.
     */

    if (
        state.currentPosition &&
        !state.users.has(
            String(state.userId)
        )
    ) {

        state.users.set(
            String(state.userId),
            {

                id:
                    String(state.userId),

                userId:
                    String(state.userId),

                name:
                    state.userName,

                lat:
                    state.currentPosition.lat,

                lng:
                    state.currentPosition.lng,

                accuracy:
                    state.currentPosition.accuracy
            }
        );
    }


    updateMembersUI();

    renderMarkers();


    console.log(
        "users",
        Array.from(
            state.users.values()
        )
    );
}


/* =========================================================
   LEFT ROOM
========================================================= */

function handleLeftRoom(data) {

    const id =
        data.userId ||
        data.id;


    if (id) {

        const safeId =
            String(id);


        state.users.delete(
            safeId
        );


        removeMarker(
            safeId
        );
    }


    updateMembersUI();

    renderMarkers();
}


/* =========================================================
   SERVER ERROR
========================================================= */

function handleServerError(data) {

    const message =
        data.message ||
        data.error ||
        "Server xatosi";


    console.error(
        "SERVER ERROR:",
        message
    );


    setRoomError(
        message
    );


    if (
        /guruh topilmadi|room not found|room.*not found/i.test(
            message
        )
    ) {

        clearRoomSession();

        state.users.clear();


        state.markers.forEach(
            (_, id) => {

                removeMarker(id);
            }
        );


        updateMembersUI();

        showSetup();
    }
}


/* =========================================================
   CREATE ROOM
========================================================= */

function createRoom() {

    setSetupError("");


    const nameInput =
        $("userName");


    const name =
        String(
            nameInput?.value ||
            ""
        ).trim();


    if (!name) {

        setSetupError(
            "Iltimos, ismingizni kiriting."
        );

        nameInput?.focus();

        return;
    }


    state.userName =
        name;


    saveSession();


    if (
        !state.ws ||
        state.ws.readyState !==
            WebSocket.OPEN
    ) {

        setSetupError(
            "Serverga ulanish kutilmoqda..."
        );


        state.pendingAction =
            "create";


        connectWebSocket();

        return;
    }


    sendMessage({

        type:
            "create-room",

        name:
            state.userName,

        userId:
            state.userId
    });
}


/* =========================================================
   JOIN ROOM
========================================================= */

function joinRoom() {

    setSetupError("");


    const nameInput =
        $("userName");


    const roomInput =
        $("roomCode");


    const name =
        String(
            nameInput?.value ||
            ""
        ).trim();


    const room =
        normalizeRoomCode(
            roomInput?.value
        );


    if (!name) {

        setSetupError(
            "Iltimos, ismingizni kiriting."
        );

        nameInput?.focus();

        return;
    }


    if (!room) {

        setSetupError(
            "Guruh kodini kiriting."
        );

        roomInput?.focus();

        return;
    }


    state.userName =
        name;

    state.roomCode =
        room;


    saveSession();


    if (
        !state.ws ||
        state.ws.readyState !==
            WebSocket.OPEN
    ) {

        setSetupError(
            "Serverga ulanish kutilmoqda..."
        );


        state.pendingAction =
            "join";


        connectWebSocket();

        return;
    }


    sendMessage({

        type:
            "join-room",

        roomCode:
            room,

        name:
            state.userName,

        userId:
            state.userId
    });
}


/* =========================================================
   SWITCH ROOM
========================================================= */

function switchRoom() {

    setRoomError("");


    const input =
        $("switchRoomInput");


    const room =
        normalizeRoomCode(
            input?.value
        );


    if (!room) {

        setRoomError(
            "Yangi guruh kodini kiriting."
        );

        input?.focus();

        return;
    }


    state.users.clear();


    state.markers.forEach(
        (_, id) => {

            removeMarker(id);
        }
    );


    state.roomCode =
        room;


    saveSession();


    updateRoomCodeUI();


    sendMessage({

        type:
            "join-room",

        roomCode:
            room
    });


    if (input) {
        input.value = "";
    }
}


/* =========================================================
   COPY ROOM
========================================================= */

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
            1500
        );

    } catch (error) {

        console.error(
            "COPY ERROR:",
            error
        );


        setText(
            "copyRoomText",
            code
        );
    }
}


/* =========================================================
   THEME
========================================================= */

function applyTheme() {

    document.documentElement.dataset.theme =
        state.theme;


    document.body.classList.toggle(
        "dark",
        state.theme === "dark"
    );


    localStorage.setItem(
        "livegps_theme",
        state.theme
    );


    const icon =
        $("themeIcon");


    if (icon) {

        icon.textContent =
            state.theme === "dark"
                ? "☀️"
                : "🌙";
    }
}


function toggleTheme() {

    state.theme =
        state.theme === "dark"
            ? "light"
            : "dark";


    applyTheme();
}


/* =========================================================
   RESTORE SESSION
========================================================= */

function restoreSession() {

    const name =
        localStorage.getItem(
            "livegps_user_name"
        );


    const room =
        localStorage.getItem(
            "livegps_room_code"
        );


    if (name) {

        state.userName =
            name;


        const input =
            $("userName");


        if (input) {

            input.value =
                name;
        }
    }


    if (room) {

        state.roomCode =
            normalizeRoomCode(
                room
            );
    }


    if (
        state.userName &&
        state.roomCode
    ) {

        showRoom();

        updateRoomCodeUI();

    } else {

        showSetup();
    }
}


/* =========================================================
   EVENTS
========================================================= */

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
            joinRoom
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


    const switchBtn =
        $("switchRoomBtn");


    if (switchBtn) {

        switchBtn.addEventListener(
            "click",
            switchRoom
        );
    }


    const myLocationBtn =
        $("myLocationBtn");


    if (myLocationBtn) {

        myLocationBtn.addEventListener(
            "click",
            centerMyLocation
        );
    }


    const centerMapBtn =
        $("centerMapBtn");


    if (centerMapBtn) {

        centerMapBtn.addEventListener(
            "click",
            centerAllUsers
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


    const roomInput =
        $("roomCode");


    if (roomInput) {

        roomInput.addEventListener(
            "keydown",
            event => {

                if (
                    event.key ===
                    "Enter"
                ) {

                    joinRoom();
                }
            }
        );
    }


    const switchInput =
        $("switchRoomInput");


    if (switchInput) {

        switchInput.addEventListener(
            "keydown",
            event => {

                if (
                    event.key ===
                    "Enter"
                ) {

                    switchRoom();
                }
            }
        );
    }
}


/* =========================================================
   WINDOW FUNCTIONS
========================================================= */

window.createRoom =
    createRoom;

window.joinRoom =
    joinRoom;

window.switchRoom =
    switchRoom;

window.copyRoomCode =
    copyRoomCode;

window.centerMyLocation =
    centerMyLocation;

window.centerAllUsers =
    centerAllUsers;

window.toggleTheme =
    toggleTheme;


/* =========================================================
   INIT
========================================================= */

async function init() {

    console.log(
        "LIVE GPS: starting..."
    );


    applyTheme();


    restoreSession();


    setupEvents();


    await initMap();


    updateConnectionStatus(
        "connecting",
        "Serverga ulanmoqda..."
    );


    connectWebSocket();


    if (
        state.userName &&
        state.roomCode
    ) {

        startLocationTracking();
    }
}


/* =========================================================
   PAGE LOAD
========================================================= */

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


/* =========================================================
   BEFORE UNLOAD
========================================================= */

window.addEventListener(
    "beforeunload",
    () => {

        stopLocationTracking();


        if (
            state.ws &&
            state.ws.readyState ===
                WebSocket.OPEN
        ) {

            try {

                state.ws.close();

            } catch (_) {}
        }
    }
);
