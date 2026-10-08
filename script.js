// ============================================================
// LIVE GPS — SCRIPT.JS
// HTML ID'lariga moslangan versiya
// index.js ga tegilmaydi
// ============================================================

const state = {
    ws: null,

    userId: null,
    userName: "",
    roomCode: "",

    connected: false,

    reconnectTimer: null,
    reconnectAttempts: 0,

    pendingAction: null,

    gpsWatchId: null,
    currentPosition: null,
    lastGoodPosition: null,

    map: null,
    yandexReady: false,
    mapReady: false,

    markers: new Map(),
    markerElements: new Map(),
    users: new Map(),

    firstGpsFix: false,

    theme: localStorage.getItem("gps-theme") || "light",

    locationRequestInProgress: false
};


// ============================================================
// HELPER
// ============================================================

function $(id) {
    return document.getElementById(id);
}


function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ============================================================
// UI
// ============================================================

function showSetup() {
    const setup = $("setupCard");
    const room = $("roomCard");

    if (setup) {
        setup.classList.remove("hidden");
    }

    if (room) {
        room.classList.add("hidden");
    }
}


function showRoom() {
    const setup = $("setupCard");
    const room = $("roomCard");

    if (setup) {
        setup.classList.add("hidden");
    }

    if (room) {
        room.classList.remove("hidden");
    }

    updateRoomCodeUI();
}


function updateRoomCodeUI() {
    const el = $("currentRoomCode");

    if (el) {
        el.textContent =
            state.roomCode || "------";
    }
}


// ============================================================
// ERROR / STATUS
// ============================================================

function showSetupError(message) {
    const el = $("setupError");

    if (el) {
        el.textContent = message || "";
        el.classList.toggle(
            "show",
            Boolean(message)
        );
    }
}


function showRoomError(message) {
    const el = $("roomError");

    if (el) {
        el.textContent = message || "";
        el.classList.toggle(
            "show",
            Boolean(message)
        );
    }
}


function updateLocationStatus(type, message) {
    const el = $("locationStatus");

    if (el) {
        el.textContent =
            message || "Kutilmoqda...";

        el.dataset.status =
            type || "waiting";
    }

    console.log(
        "LOCATION STATUS:",
        type,
        message
    );
}


function updateConnectionUI(connected) {
    const pill =
        $("connectionPill");

    const text =
        $("connectionText");

    const status =
        $("connectionStatus");

    if (pill) {
        pill.classList.toggle(
            "offline",
            !connected
        );

        pill.classList.toggle(
            "online",
            connected
        );
    }

    if (text) {
        text.textContent =
            connected
                ? "Online"
                : "Offline";
    }

    if (status) {
        status.textContent =
            connected
                ? "Ulangan"
                : "Ulanmoqda...";
    }
}


// ============================================================
// YANDEX MAPS
// ============================================================

async function loadYandexMaps() {
    if (state.yandexReady) {
        return true;
    }

    const started =
        Date.now();

    while (
        typeof ymaps3 === "undefined" &&
        Date.now() - started < 15000
    ) {
        await new Promise(
            resolve =>
                setTimeout(resolve, 200)
        );
    }

    if (
        typeof ymaps3 === "undefined"
    ) {
        console.error(
            "YANDEX MAPS API TOPILMADI"
        );

        return false;
    }

    try {
        await ymaps3.ready;

        state.yandexReady = true;

        console.log(
            "YANDEX MAPS: ready"
        );

        return true;

    } catch (error) {
        console.error(
            "YANDEX MAPS READY ERROR:",
            error
        );

        return false;
    }
}


async function initMap() {
    if (state.mapReady) {
        return;
    }

    const mapElement =
        $("map");

    if (!mapElement) {
        console.error(
            "MAP ELEMENT TOPILMADI"
        );

        return;
    }

    const ready =
        await loadYandexMaps();

    if (!ready) {
        return;
    }

    try {
        const {
            YMap,
            YMapDefaultSchemeLayer,
            YMapDefaultFeaturesLayer,
            YMapListener
        } = ymaps3;

        state.map =
            new YMap(
                mapElement,
                {
                    location: {
                        center: [
                            69.2401,
                            41.2995
                        ],
                        zoom: 12
                    }
                }
            );

        state.map.addChild(
            new YMapDefaultSchemeLayer()
        );

        state.map.addChild(
            new YMapDefaultFeaturesLayer()
        );


        // ----------------------------------------------------
        // MARKER CLICK
        // ----------------------------------------------------

        if (YMapListener) {
            const listener =
                new YMapListener({
                    layer: "any",

                    onClick: object => {
                        try {
                            console.log(
                                "MAP CLICK:",
                                object
                            );

                            if (!object) {
                                return;
                            }

                            const entity =
                                object.entity;

                            if (!entity) {
                                return;
                            }

                            const element =
                                entity.element ||
                                entity._element;

                            if (!element) {
                                return;
                            }

                            const id =
                                element.dataset?.userId;

                            if (!id) {
                                return;
                            }

                            centerSelectedUser(
                                id
                            );

                        } catch (error) {
                            console.warn(
                                "MARKER CLICK ERROR:",
                                error
                            );
                        }
                    }
                });

            state.map.addChild(
                listener
            );
        }


        state.mapReady = true;

        console.log(
            "YANDEX MAP: initialized"
        );

        renderMarkers();

    } catch (error) {
        console.error(
            "YANDEX MAP INIT ERROR:",
            error
        );
    }
}


function centerMap(
    lng,
    lat,
    zoom = 17
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
        center: [
            lng,
            lat
        ],
        zoom
    });
}


// ============================================================
// GPS VALIDATION
// ============================================================

function isInsideUzbekistan(
    lat,
    lng
) {
    return (
        lat >= 37 &&
        lat <= 46 &&
        lng >= 55 &&
        lng <= 74
    );
}


function distanceMeters(
    lat1,
    lng1,
    lat2,
    lng2
) {
    const R = 6371000;

    const p1 =
        lat1 * Math.PI / 180;

    const p2 =
        lat2 * Math.PI / 180;

    const dp =
        (lat2 - lat1) *
        Math.PI / 180;

    const dl =
        (lng2 - lng1) *
        Math.PI / 180;

    const a =
        Math.sin(dp / 2) ** 2 +
        Math.cos(p1) *
        Math.cos(p2) *
        Math.sin(dl / 2) ** 2;

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return R * c;
}


function isGoodGPSPosition(
    position
) {
    if (
        !position ||
        !position.coords
    ) {
        return false;
    }

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


    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return false;
    }


    if (
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
    ) {
        return false;
    }


    // Afrika yoki boshqa qit'a bo‘lsa
    // qabul qilmaymiz.
    if (
        !isInsideUzbekistan(
            lat,
            lng
        )
    ) {
        console.warn(
            "GPS REJECTED:",
            {
                lat,
                lng,
                accuracy
            }
        );

        return false;
    }


    // Juda yomon aniqlik.
    if (
        Number.isFinite(accuracy) &&
        accuracy > 1500
    ) {
        console.warn(
            "GPS ACCURACY TOO LOW:",
            accuracy
        );

        return false;
    }


    // Birdaniga katta sakrashni rad etamiz.
    if (state.lastGoodPosition) {
        const old =
            state.lastGoodPosition;

        const jump =
            distanceMeters(
                old.lat,
                old.lng,
                lat,
                lng
            );

        const oldAccuracy =
            Number(old.accuracy) || 100;

        const newAccuracy =
            Number(accuracy) || 100;

        const allowed =
            Math.max(
                3000,
                oldAccuracy * 8,
                newAccuracy * 8
            );

        if (
            jump > allowed
        ) {
            console.warn(
                "GPS JUMP REJECTED:",
                {
                    jump,
                    allowed
                }
            );

            return false;
        }
    }

    return true;
}


// ============================================================
// GPS REQUEST
// ============================================================

function requestCurrentLocation() {
    if (
        !navigator.geolocation
    ) {
        updateLocationStatus(
            "error",
            "Bu qurilmada GPS mavjud emas."
        );

        return;
    }

    if (
        state.locationRequestInProgress
    ) {
        return;
    }

    state.locationRequestInProgress =
        true;

    updateLocationStatus(
        "waiting",
        "Telefon GPS joylashuvni aniqlamoqda..."
    );

    navigator.geolocation.getCurrentPosition(
        position => {
            state.locationRequestInProgress =
                false;

            handlePosition(
                position
            );
        },

        error => {
            state.locationRequestInProgress =
                false;

            handleLocationError(
                error
            );
        },

        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 30000
        }
    );
}


function startGPS() {
    if (
        !navigator.geolocation
    ) {
        updateLocationStatus(
            "error",
            "Telefon GPS funksiyasini qo‘llab-quvvatlamaydi."
        );

        return;
    }


    if (
        state.gpsWatchId !== null
    ) {
        navigator.geolocation.clearWatch(
            state.gpsWatchId
        );

        state.gpsWatchId =
            null;
    }


    updateLocationStatus(
        "waiting",
        "Telefon GPS aniqlanmoqda..."
    );


    // Birinchi marta yangi koordinata so‘raymiz.
    requestCurrentLocation();


    // Keyin doimiy kuzatamiz.
    state.gpsWatchId =
        navigator.geolocation.watchPosition(
            handlePosition,
            handleLocationError,
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 60000
            }
        );
}


function handlePosition(
    position
) {
    if (
        !position ||
        !position.coords
    ) {
        return;
    }

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


    console.log(
        "RAW GPS:",
        {
            lat,
            lng,
            accuracy
        }
    );


    if (
        !isGoodGPSPosition(
            position
        )
    ) {
        updateLocationStatus(
            "waiting",
            "GPS noto‘g‘ri joy ko‘rsatmoqda. Yangi signal kutilmoqda..."
        );

        return;
    }


    const clean =
        {
            lat,
            lng,
            accuracy:
                Number.isFinite(
                    accuracy
                )
                    ? accuracy
                    : 0,
            timestamp:
                Number(
                    position.timestamp
                ) ||
                Date.now()
        };


    state.currentPosition =
        clean;

    state.lastGoodPosition =
        clean;


    console.log(
        "GOOD GPS:",
        clean
    );


    if (
        !state.firstGpsFix
    ) {
        state.firstGpsFix =
            true;

        centerMap(
            lng,
            lat,
            17
        );
    }


    updateLocationStatus(
        "success",
        `Aniqlandi ±${Math.round(
            clean.accuracy
        )} m`
    );


    // O‘zimizni users ichida yangilaymiz.
    if (
        state.userId
    ) {
        const id =
            String(
                state.userId
            );

        const old =
            state.users.get(id) ||
            {};

        state.users.set(
            id,
            {
                ...old,

                id,

                name:
                    state.userName ||
                    old.name ||
                    "Men",

                lat,
                lng,

                accuracy:
                    clean.accuracy,

                isMe: true
            }
        );
    }


    renderMarkers();
    updateMembersUI();

    sendLocationToServer(
        clean
    );
}


function handleLocationError(
    error
) {
    console.error(
        "GPS ERROR:",
        error
    );

    if (
        error?.code === 1
    ) {
        updateLocationStatus(
            "error",
            "Joylashuvga ruxsat berilmagan. Brauzerda Location/Joylashuvni yoqing."
        );

        return;
    }


    if (
        error?.code === 2
    ) {
        updateLocationStatus(
            "error",
            "GPS signal topilmadi. Telefonda Location xizmatini yoqing."
        );

        return;
    }


    if (
        error?.code === 3
    ) {
        updateLocationStatus(
            "waiting",
            "GPS javobi kechikmoqda. Qayta urinilmoqda..."
        );

        return;
    }


    updateLocationStatus(
        "error",
        "Joylashuvni aniqlashda xatolik."
    );
}


// ============================================================
// SERVER LOCATION
// ============================================================

function sendLocationToServer(
    position
) {
    if (
        !state.ws ||
        state.ws.readyState !==
        WebSocket.OPEN
    ) {
        return;
    }

    if (!state.roomCode) {
        return;
    }

    if (!position) {
        return;
    }


    try {
        state.ws.send(
            JSON.stringify({
                type: "location",

                lat:
                    position.lat,

                lng:
                    position.lng,

                accuracy:
                    position.accuracy || 0
            })
        );

    } catch (error) {
        console.error(
            "LOCATION SEND ERROR:",
            error
        );
    }
}


// ============================================================
// MARKERS
// ============================================================

function createMarkerElement(
    user
) {
    const wrapper =
        document.createElement(
            "div"
        );

    wrapper.className =
        "gps-marker " +
        (
            String(user.id) ===
            String(state.userId)
                ? "me"
                : "other"
        );

    wrapper.dataset.userId =
        String(user.id);

    wrapper.style.pointerEvents =
        "auto";

    wrapper.style.cursor =
        "pointer";


    wrapper.innerHTML = `
        <div class="gps-marker-pin">
            <div class="gps-marker-dot"></div>
        </div>

        <div class="gps-marker-label">
            ${escapeHTML(
                user.name ||
                "Foydalanuvchi"
            )}
        </div>
    `;


    // Telefon / oddiy browser fallback.
    wrapper.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();

            centerSelectedUser(
                user.id
            );
        },
        true
    );


    wrapper.addEventListener(
        "pointerup",
        event => {
            event.preventDefault();
            event.stopPropagation();

            centerSelectedUser(
                user.id
            );
        },
        true
    );


    return wrapper;
}


function renderMarkers() {
    if (
        !state.map ||
        !state.mapReady ||
        typeof ymaps3 === "undefined"
    ) {
        return;
    }

    const {
        YMapMarker
    } = ymaps3;

    if (!YMapMarker) {
        return;
    }


    const validIds =
        new Set();


    for (
        const [
            id,
            user
        ] of state.users
    ) {
        const userId =
            String(id);

        const lat =
            Number(
                user.lat
            );

        const lng =
            Number(
                user.lng
            );


        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {
            continue;
        }


        // Noto‘g‘ri qit'ani marker qilmaymiz.
        if (
            !isInsideUzbekistan(
                lat,
                lng
            )
        ) {
            continue;
        }


        validIds.add(
            userId
        );


        let marker =
            state.markers.get(
                userId
            );


        if (!marker) {
            const element =
                createMarkerElement({
                    ...user,
                    id: userId
                });


            marker =
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
                userId,
                marker
            );


            state.markerElements.set(
                userId,
                element
            );

        } else {
            try {
                marker.update({
                    coordinates: [
                        lng,
                        lat
                    ]
                });
            } catch (error) {
                console.warn(
                    "MARKER UPDATE ERROR:",
                    error
                );
            }


            const element =
                state.markerElements.get(
                    userId
                );


            if (element) {
                element.className =
                    "gps-marker " +
                    (
                        userId ===
                        String(
                            state.userId
                        )
                            ? "me"
                            : "other"
                    );


                const label =
                    element.querySelector(
                        ".gps-marker-label"
                    );


                if (label) {
                    label.textContent =
                        user.name ||
                        "Foydalanuvchi";
                }
            }
        }
    }


    // Eski markerlarni o‘chirish.
    for (
        const [
            id,
            marker
        ] of state.markers
    ) {
        if (
            !validIds.has(
                String(id)
            )
        ) {
            try {
                state.map.removeChild(
                    marker
                );
            } catch (error) {
                console.warn(
                    "MARKER REMOVE ERROR:",
                    error
                );
            }


            state.markers.delete(
                id
            );

            state.markerElements.delete(
                id
            );
        }
    }
}


// ============================================================
// SELECT USER
// ============================================================

function centerSelectedUser(
    userId
) {
    const id =
        String(userId);

    const user =
        state.users.get(
            id
        );


    if (!user) {
        console.warn(
            "USER NOT FOUND:",
            id
        );

        return;
    }


    const lat =
        Number(
            user.lat
        );

    const lng =
        Number(
            user.lng
        );


    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return;
    }


    console.log(
        "CENTER USER:",
        user
    );


    centerMap(
        lng,
        lat,
        18
    );


    for (
        const element
        of state.markerElements.values()
    ) {
        element.classList.remove(
            "selected"
        );
    }


    const selected =
        state.markerElements.get(
            id
        );


    if (selected) {
        selected.classList.add(
            "selected"
        );
    }


    updateLocationStatus(
        "success",
        `${user.name || "Foydalanuvchi"} joylashuvi ko‘rsatildi`
    );
}


// ============================================================
// MEMBERS
// ============================================================

function updateMembersUI() {
    const list =
        $("membersList");

    const count =
        $("membersCount");


    if (!list) {
        return;
    }


    const users =
        Array.from(
            state.users.values()
        );


    if (count) {
        count.textContent =
            String(
                users.length
            );
    }


    list.innerHTML = "";


    if (!users.length) {
        list.innerHTML = `
            <div class="empty-members">
                A'zolar kutilmoqda...
            </div>
        `;

        return;
    }


    users.forEach(
        user => {
            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "member-item";


            item.dataset.userId =
                String(user.id);


            const isMe =
                String(user.id) ===
                String(state.userId);


            item.innerHTML = `
                <div class="member-avatar">
                    ${escapeHTML(
                        String(
                            user.name ||
                            "?"
                        )
                            .charAt(0)
                            .toUpperCase()
                    )}
                </div>

                <div class="member-info">
                    <div class="member-name">
                        ${escapeHTML(
                            user.name ||
                            "Foydalanuvchi"
                        )}
                        ${
                            isMe
                                ? " <span>(Siz)</span>"
                                : ""
                        }
                    </div>

                    <div class="member-location">
                        ${
                            Number.isFinite(
                                Number(
                                    user.lat
                                )
                            )
                                ? "📍 Joylashuv mavjud"
                                : "⏳ Joylashuv kutilmoqda"
                        }
                    </div>
                </div>
            `;


            item.addEventListener(
                "click",
                () => {
                    centerSelectedUser(
                        user.id
                    );
                }
            );


            item.addEventListener(
                "touchend",
                event => {
                    event.preventDefault();

                    centerSelectedUser(
                        user.id
                    );
                },
                {
                    passive: false
                }
            );


            item.tabIndex = 0;


            item.addEventListener(
                "keydown",
                event => {
                    if (
                        event.key === "Enter" ||
                        event.key === " "
                    ) {
                        event.preventDefault();

                        centerSelectedUser(
                            user.id
                        );
                    }
                }
            );


            list.appendChild(
                item
            );
        }
    );
}


// ============================================================
// SERVER USERS
// ============================================================

function handleUsers(
    serverUsers
) {
    if (
        !Array.isArray(
            serverUsers
        )
    ) {
        return;
    }


    const next =
        new Map();


    serverUsers.forEach(
        raw => {
            if (!raw) {
                return;
            }


            const id =
                String(
                    raw.id ??
                    raw.userId ??
                    ""
                );


            if (!id) {
                return;
            }


            const lat =
                Number(
                    raw.lat
                );

            const lng =
                Number(
                    raw.lng
                );


            if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lng)
            ) {
                next.set(
                    id,
                    {
                        ...raw,
                        id
                    }
                );

                return;
            }


            // Server noto‘g‘ri joy yuborsa
            // frontend uni ko‘rsatmaydi.
            if (
                !isInsideUzbekistan(
                    lat,
                    lng
                )
            ) {
                console.warn(
                    "SERVER GPS REJECTED:",
                    raw
                );

                return;
            }


            next.set(
                id,
                {
                    ...raw,

                    id,
                    lat,
                    lng,

                    accuracy:
                        Number(
                            raw.accuracy
                        ) || 0
                }
            );
        }
    );


    // O‘zimizning yangi GPS koordinatamiz.
    if (
        state.userId &&
        state.currentPosition
    ) {
        const myId =
            String(
                state.userId
            );

        const pos =
            state.currentPosition;

        const old =
            next.get(
                myId
            );


        next.set(
            myId,
            {
                ...(old || {}),

                id: myId,

                name:
                    state.userName ||
                    old?.name ||
                    "Men",

                lat:
                    pos.lat,

                lng:
                    pos.lng,

                accuracy:
                    pos.accuracy,

                isMe: true
            }
        );
    }


    state.users =
        next;


    renderMarkers();
    updateMembersUI();
}


// ============================================================
// WEBSOCKET
// ============================================================

const WS_URL =
    location.protocol === "https:"
        ? `wss://${location.host}`
        : `ws://${location.host}`;


function sendWS(data) {
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
                data
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


// ============================================================
// CREATE ROOM
// ============================================================

function createRoom() {
    // MUHIM:
    // HTML'da ID = userName
    const input =
        $("userName");


    const name =
        String(
            input?.value || ""
        ).trim();


    console.log(
        "CREATE ROOM NAME:",
        name
    );


    if (!name) {
        showSetupError(
            "Avval ismingizni kiriting."
        );

        input?.focus();

        return;
    }


    showSetupError("");


    state.userName =
        name;


    localStorage.setItem(
        "gps-user-name",
        name
    );


    state.pendingAction = {
        type: "create-room"
    };


    connectWebSocket();
}


// ============================================================
// JOIN ROOM
// ============================================================

function joinRoom() {
    // MUHIM:
    // HTML'da ID = userName
    const nameInput =
        $("userName");


    // MUHIM:
    // HTML'da ID = roomCode
    const roomInput =
        $("roomCode");


    const name =
        String(
            nameInput?.value || ""
        ).trim();


    const room =
        String(
            roomInput?.value || ""
        )
            .trim()
            .toUpperCase();


    console.log(
        "JOIN ROOM:",
        {
            name,
            room
        }
    );


    if (!name) {
        showSetupError(
            "Avval ismingizni kiriting."
        );

        nameInput?.focus();

        return;
    }


    if (!room) {
        showSetupError(
            "Guruh kodini kiriting."
        );

        roomInput?.focus();

        return;
    }


    showSetupError("");


    state.userName =
        name;

    state.roomCode =
        room;


    localStorage.setItem(
        "gps-user-name",
        name
    );

    localStorage.setItem(
        "gps-room-code",
        room
    );


    state.pendingAction = {
        type: "join-room",
        room
    };


    connectWebSocket();
}


// ============================================================
// WEBSOCKET CONNECT
// ============================================================

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


    console.log(
        "SERVER: connecting..."
    );


    try {
        state.ws =
            new WebSocket(
                WS_URL
            );

    } catch (error) {
        console.error(
            "WS CREATE ERROR:",
            error
        );

        scheduleReconnect();

        return;
    }


    state.ws.onopen = () => {
        state.connected =
            true;

        state.reconnectAttempts =
            0;

        updateConnectionUI(
            true
        );


        console.log(
            "SERVER: connected"
        );


        if (
            state.pendingAction
        ) {
            sendWS(
                state.pendingAction
            );

            state.pendingAction =
                null;
        }


        startGPS();
    };


    state.ws.onmessage =
        event => {
            let data;

            try {
                data =
                    JSON.parse(
                        event.data
                    );

            } catch (error) {
                console.warn(
                    "INVALID SERVER DATA:",
                    event.data
                );

                return;
            }


            console.log(
                "SERVER:",
                data
            );


            handleServerMessage(
                data
            );
        };


    state.ws.onclose =
        () => {
            state.connected =
                false;

            updateConnectionUI(
                false
            );


            console.warn(
                "SERVER: disconnected"
            );


            scheduleReconnect();
        };


    state.ws.onerror =
        error => {
            console.error(
                "SERVER ERROR:",
                error
            );
        };
}


// ============================================================
// SERVER MESSAGE
// ============================================================

function handleServerMessage(
    data
) {
    if (!data) {
        return;
    }


    const type =
        data.type;


    // --------------------------------------------------------
    // CONNECTED
    // --------------------------------------------------------

    if (
        type === "connected"
    ) {
        if (
            data.userId !==
            undefined
        ) {
            state.userId =
                String(
                    data.userId
                );
        }

        return;
    }


    // --------------------------------------------------------
    // ROOM CREATED
    // --------------------------------------------------------

    if (
        type === "room-created" ||
        type === "room_created"
    ) {
        state.roomCode =
            String(
                data.roomCode ||
                data.code ||
                ""
            )
                .toUpperCase();


        if (
            data.userId !==
            undefined
        ) {
            state.userId =
                String(
                    data.userId
                );
        }


        localStorage.setItem(
            "gps-room-code",
            state.roomCode
        );


        showRoom();

        updateRoomCodeUI();

        startGPS();

        return;
    }


    // --------------------------------------------------------
    // JOINED ROOM
    // --------------------------------------------------------

    if (
        type === "joined-room" ||
        type === "joined_room"
    ) {
        state.roomCode =
            String(
                data.roomCode ||
                data.code ||
                state.roomCode ||
                ""
            )
                .toUpperCase();


        if (
            data.userId !==
            undefined
        ) {
            state.userId =
                String(
                    data.userId
                );
        }


        localStorage.setItem(
            "gps-room-code",
            state.roomCode
        );


        showRoom();

        updateRoomCodeUI();

        startGPS();

        return;
    }


    // --------------------------------------------------------
    // USERS
    // --------------------------------------------------------

    if (
        type === "users"
    ) {
        handleUsers(
            data.users ||
            data.members ||
            []
        );

        return;
    }


    // --------------------------------------------------------
    // LOCATION
    // --------------------------------------------------------

    if (
        type === "location" ||
        type === "user-location" ||
        type === "user-updated"
    ) {
        const raw =
            data.user ||
            data.member;


        if (!raw) {
            return;
        }


        const id =
            String(
                raw.id ??
                raw.userId ??
                data.userId ??
                ""
            );


        const lat =
            Number(
                raw.lat
            );

        const lng =
            Number(
                raw.lng
            );


        if (
            !id ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {
            return;
        }


        if (
            !isInsideUzbekistan(
                lat,
                lng
            )
        ) {
            console.warn(
                "LIVE LOCATION REJECTED:",
                raw
            );

            return;
        }


        state.users.set(
            id,
            {
                ...raw,

                id,
                lat,
                lng
            }
        );


        renderMarkers();
        updateMembersUI();

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
            "Server xatosi.";


        console.error(
            "SERVER ERROR:",
            message
        );


        if (
            $("roomCard") &&
            !$("roomCard").classList.contains(
                "hidden"
            )
        ) {
            showRoomError(
                message
            );
        } else {
            showSetupError(
                message
            );
        }


        return;
    }
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


    state.reconnectAttempts++;


    const delay =
        Math.min(
            1000 *
            Math.pow(
                2,
                Math.min(
                    state.reconnectAttempts,
                    5
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


// ============================================================
// MY LOCATION
// ============================================================

function centerMyLocation() {
    if (
        state.currentPosition
    ) {
        centerMap(
            state.currentPosition.lng,
            state.currentPosition.lat,
            18
        );

        return;
    }


    requestCurrentLocation();
}


// ============================================================
// CENTER GROUP
// ============================================================

function centerAllUsers() {
    const users =
        Array.from(
            state.users.values()
        )
            .filter(
                user =>
                    Number.isFinite(
                        Number(user.lat)
                    ) &&
                    Number.isFinite(
                        Number(user.lng)
                    )
            );


    if (!users.length) {
        if (
            state.currentPosition
        ) {
            centerMyLocation();
        }

        return;
    }


    // Hozircha guruh markazini
    // o‘rtacha koordinata orqali topamiz.
    let lat = 0;
    let lng = 0;


    users.forEach(
        user => {
            lat +=
                Number(
                    user.lat
                );

            lng +=
                Number(
                    user.lng
                );
        }
    );


    lat /=
        users.length;

    lng /=
        users.length;


    centerMap(
        lng,
        lat,
        14
    );
}


// ============================================================
// SWITCH ROOM
// ============================================================

function switchRoom() {
    const input =
        $("switchRoomInput");


    const room =
        String(
            input?.value || ""
        )
            .trim()
            .toUpperCase();


    if (!room) {
        showRoomError(
            "Guruh kodini kiriting."
        );

        return;
    }


    showRoomError("");


    state.roomCode =
        room;


    localStorage.setItem(
        "gps-room-code",
        room
    );


    state.pendingAction = {
        type: "join-room",
        room
    };


    if (
        state.ws &&
        state.ws.readyState ===
        WebSocket.OPEN
    ) {
        sendWS(
            state.pendingAction
        );

        state.pendingAction =
            null;

    } else {
        connectWebSocket();
    }
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

        const text =
            $("copyRoomText");


        if (text) {
            text.textContent =
                "Nusxalandi ✓";


            setTimeout(
                () => {
                    text.textContent =
                        "Nusxalash";
                },
                1800
            );
        }

    } catch (error) {
        console.warn(
            "COPY ERROR:",
            error
        );
    }
}


// ============================================================
// RESTORE SESSION
// ============================================================

function restoreSession() {
    const savedName =
        localStorage.getItem(
            "gps-user-name"
        );


    const savedRoom =
        localStorage.getItem(
            "gps-room-code"
        );


    const nameInput =
        $("userName");


    const roomInput =
        $("roomCode");


    if (
        nameInput &&
        savedName
    ) {
        nameInput.value =
            savedName;
    }


    if (
        roomInput &&
        savedRoom
    ) {
        roomInput.value =
            savedRoom;
    }


    if (
        savedName &&
        savedRoom
    ) {
        state.userName =
            savedName;

        state.roomCode =
            savedRoom.toUpperCase();


        state.pendingAction = {
            type: "join-room",
            room: state.roomCode
        };


        showRoom();

        connectWebSocket();

    } else {
        showSetup();

        initMap();
    }
}


// ============================================================
// BUTTONS
// ============================================================

function setupButtons() {
    const createBtn =
        $("createRoomBtn");


    const joinBtn =
        $("joinRoomBtn");


    const myLocationBtn =
        $("myLocationBtn");


    const centerMapBtn =
        $("centerMapBtn");


    const switchBtn =
        $("switchRoomBtn");


    const copyRoomBtn =
        $("copyRoomBtn");


    if (createBtn) {
        createBtn.addEventListener(
            "click",
            createRoom
        );
    }


    if (joinBtn) {
        joinBtn.addEventListener(
            "click",
            joinRoom
        );
    }


    if (myLocationBtn) {
        myLocationBtn.addEventListener(
            "click",
            centerMyLocation
        );
    }


    if (centerMapBtn) {
        centerMapBtn.addEventListener(
            "click",
            centerAllUsers
        );
    }


    if (switchBtn) {
        switchBtn.addEventListener(
            "click",
            switchRoom
        );
    }


    if (copyRoomBtn) {
        copyRoomBtn.addEventListener(
            "click",
            copyRoomCode
        );
    }
}


// ============================================================
// THEME
// ============================================================

function applyTheme() {
    document.documentElement.dataset.theme =
        state.theme;


    document.body.classList.toggle(
        "dark",
        state.theme === "dark"
    );


    const icon =
        $("themeIcon");


    if (icon) {
        icon.textContent =
            state.theme === "dark"
                ? "☀"
                : "☾";
    }
}


function setupTheme() {
    applyTheme();


    const themeBtn =
        $("themeBtn");


    if (!themeBtn) {
        return;
    }


    themeBtn.addEventListener(
        "click",
        () => {
            state.theme =
                state.theme === "dark"
                    ? "light"
                    : "dark";


            localStorage.setItem(
                "gps-theme",
                state.theme
            );


            applyTheme();
        }
    );
}


// ============================================================
// INIT
// ============================================================

async function init() {
    console.log(
        "LIVE GPS: starting..."
    );


    setupButtons();
    setupTheme();


    // Xarita tayyorlanadi.
    await initMap();


    // Saqlangan ism/guruhni tekshiramiz.
    restoreSession();
}


// ============================================================
// START
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
