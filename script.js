// ============================================================
// LIVE GPS — SCRIPT.JS
// Telefon GPS + Yandex Maps + Guruh
// Backend / server.js ga tegilmaydi
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
// DOM
// ============================================================

const $ = (id) => document.getElementById(id);


// ============================================================
// SETUP / ROOM UI
// ============================================================

function showSetup() {
    const setup = $("setupCard");
    const room = $("roomCard");

    if (setup) setup.classList.remove("hidden");
    if (room) room.classList.add("hidden");
}

function showRoom() {
    const setup = $("setupCard");
    const room = $("roomCard");

    if (setup) setup.classList.add("hidden");
    if (room) room.classList.remove("hidden");

    updateRoomCodeUI();
}

function updateRoomCodeUI() {
    const el = $("currentRoomCode");

    if (el) {
        el.textContent = state.roomCode || "------";
    }
}


// ============================================================
// LOCATION STATUS
// ============================================================

function updateLocationStatus(type, message) {
    let el = $("locationStatus");

    if (!el) {
        el = document.createElement("div");
        el.id = "locationStatus";

        el.style.position = "fixed";
        el.style.left = "50%";
        el.style.bottom = "85px";
        el.style.transform = "translateX(-50%)";
        el.style.zIndex = "9999";
        el.style.maxWidth = "calc(100vw - 30px)";
        el.style.padding = "9px 14px";
        el.style.borderRadius = "12px";
        el.style.fontSize = "13px";
        el.style.fontWeight = "700";
        el.style.textAlign = "center";
        el.style.background = "rgba(20,25,22,.92)";
        el.style.color = "#fff";
        el.style.boxShadow = "0 8px 25px rgba(0,0,0,.20)";
        el.style.backdropFilter = "blur(10px)";
        el.style.webkitBackdropFilter = "blur(10px)";

        document.body.appendChild(el);
    }

    el.textContent = message;

    if (type === "success") {
        el.style.border = "1px solid rgba(25,214,107,.5)";
    } else if (type === "error") {
        el.style.border = "1px solid rgba(255,80,80,.6)";
    } else {
        el.style.border = "1px solid rgba(255,255,255,.15)";
    }

    clearTimeout(el._hideTimer);

    if (type === "success") {
        el._hideTimer = setTimeout(() => {
            el.remove();
        }, 3000);
    }
}


// ============================================================
// YANDEX MAPS LOADER
// ============================================================

async function loadYandexMaps() {
    if (state.yandexReady) return true;

    updateLocationStatus(
        "waiting",
        "Xarita yuklanmoqda..."
    );

    const started = Date.now();

    while (
        typeof ymaps3 === "undefined" &&
        Date.now() - started < 15000
    ) {
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (typeof ymaps3 === "undefined") {
        console.error("YANDEX MAPS: API topilmadi");

        updateLocationStatus(
            "error",
            "Yandex xaritasi yuklanmadi."
        );

        return false;
    }

    try {
        await ymaps3.ready;

        state.yandexReady = true;

        console.log("YANDEX MAPS: ready");

        return true;

    } catch (error) {
        console.error("YANDEX MAPS READY ERROR:", error);

        updateLocationStatus(
            "error",
            "Yandex Maps ishga tushmadi."
        );

        return false;
    }
}


// ============================================================
// MAP INIT
// ============================================================

async function initMap() {
    if (state.mapReady) return;

    const ok = await loadYandexMaps();

    if (!ok) return;

    const mapEl = $("map");

    if (!mapEl) {
        console.error("MAP ELEMENT TOPILMADI");
        return;
    }

    try {
        const {
            YMap,
            YMapDefaultSchemeLayer,
            YMapDefaultFeaturesLayer,
            YMapListener
        } = ymaps3;

        state.map = new YMap(
            mapEl,
            {
                location: {
                    center: [69.2401, 41.2995],
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
        // Yandex Maps official event listener
        // ----------------------------------------------------

        if (YMapListener) {
            const listener = new YMapListener({
                layer: "any",

                onClick: (object) => {
                    try {
                        console.log(
                            "MAP CLICK OBJECT:",
                            object
                        );

                        if (!object) return;

                        const entity = object.entity;

                        if (!entity) return;

                        const element =
                            entity.element ||
                            entity._element ||
                            null;

                        if (!element) return;

                        const userId =
                            element.dataset?.userId;

                        if (!userId) return;

                        centerSelectedUser(userId);

                    } catch (error) {
                        console.warn(
                            "MAP MARKER CLICK ERROR:",
                            error
                        );
                    }
                }
            });

            state.map.addChild(listener);
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

        updateLocationStatus(
            "error",
            "Xaritani ishga tushirib bo‘lmadi."
        );
    }
}


// ============================================================
// MAP CENTER
// ============================================================

function centerMap(lng, lat, zoom = 17) {
    if (!state.map) return;

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


// ============================================================
// GPS COORDINATE VALIDATION
// ============================================================

// Sayt O‘zbekiston foydalanuvchilari uchun ishlatilayotganligi
// sababli Afrikadagi kabi keskin noto‘g‘ri koordinatalarni
// qabul qilmaymiz.
//
// O‘zbekistonning taxminiy kengroq chegarasi:
// longitude: 55 - 74
// latitude : 37 - 46

function isInsideUzbekistan(lat, lng) {
    return (
        lat >= 37 &&
        lat <= 46 &&
        lng >= 55 &&
        lng <= 74
    );
}


// ============================================================
// DISTANCE
// ============================================================

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


// ============================================================
// GPS VALIDATION
// ============================================================

function isGoodGPSPosition(position) {
    if (!position || !position.coords) {
        return false;
    }

    const lat = Number(position.coords.latitude);
    const lng = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy);

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

    // Eng muhim himoya:
    // Afrika, Amerika va boshqa tasodifiy joylarni
    // O‘zbekiston ichidagi sayt uchun qabul qilmaymiz.
    if (!isInsideUzbekistan(lat, lng)) {
        console.warn(
            "GPS REJECTED — outside Uzbekistan:",
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
            "GPS REJECTED — accuracy too low:",
            accuracy
        );

        return false;
    }

    // Agar oldingi haqiqiy koordinata mavjud bo‘lsa,
    // birdaniga juda katta sakrashni qabul qilmaymiz.
    if (state.lastGoodPosition) {
        const old = state.lastGoodPosition;

        const jump = distanceMeters(
            old.lat,
            old.lng,
            lat,
            lng
        );

        const oldAccuracy =
            Number(old.accuracy) || 100;

        const currentAccuracy =
            Number(accuracy) || 100;

        const allowed =
            Math.max(
                3000,
                oldAccuracy * 8,
                currentAccuracy * 8
            );

        if (jump > allowed) {
            console.warn(
                "GPS REJECTED — impossible jump:",
                {
                    jump,
                    allowed,
                    lat,
                    lng
                }
            );

            return false;
        }
    }

    return true;
}


// ============================================================
// REQUEST CURRENT GPS
// ============================================================

function requestCurrentLocation() {
    if (!navigator.geolocation) {
        updateLocationStatus(
            "error",
            "Bu telefonda GPS/Joylashuv qo‘llab-quvvatlanmaydi."
        );

        return;
    }

    if (state.locationRequestInProgress) {
        return;
    }

    state.locationRequestInProgress = true;

    updateLocationStatus(
        "waiting",
        "Telefon GPS joylashuvingizni aniqlamoqda..."
    );

    navigator.geolocation.getCurrentPosition(
        (position) => {
            state.locationRequestInProgress = false;

            handlePosition(position);
        },

        (error) => {
            state.locationRequestInProgress = false;

            handleLocationError(error);
        },

        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 30000
        }
    );
}


// ============================================================
// GPS WATCH START
// ============================================================

function startGPS() {
    if (!navigator.geolocation) {
        updateLocationStatus(
            "error",
            "Telefon GPS funksiyasi mavjud emas."
        );

        return;
    }

    if (state.gpsWatchId !== null) {
        navigator.geolocation.clearWatch(
            state.gpsWatchId
        );

        state.gpsWatchId = null;
    }

    updateLocationStatus(
        "waiting",
        "Telefon GPS aniqlanmoqda..."
    );

    // Avval yangi bir martalik GPS so‘raymiz.
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


// ============================================================
// GPS POSITION
// ============================================================

function handlePosition(position) {
    if (!position || !position.coords) {
        return;
    }

    const lat =
        Number(position.coords.latitude);

    const lng =
        Number(position.coords.longitude);

    const accuracy =
        Number(position.coords.accuracy);

    console.log(
        "RAW GPS:",
        {
            lat,
            lng,
            accuracy
        }
    );

    // Noto‘g‘ri GPS bo‘lsa serverga YUBORMAYMIZ.
    if (!isGoodGPSPosition(position)) {
        updateLocationStatus(
            "waiting",
            "GPS noto‘g‘ri joy ko‘rsatmoqda. Yangi signal kutilmoqda..."
        );

        return;
    }

    const cleanPosition = {
        lat,
        lng,
        accuracy: Number.isFinite(accuracy)
            ? accuracy
            : 0,
        timestamp:
            Number(position.timestamp) ||
            Date.now()
    };

    state.currentPosition =
        cleanPosition;

    state.lastGoodPosition =
        cleanPosition;

    console.log(
        "GOOD GPS:",
        cleanPosition
    );

    // Birinchi haqiqiy GPS topilganda xaritani shu yerga olib boramiz.
    if (!state.firstGpsFix) {
        state.firstGpsFix = true;

        centerMap(
            lng,
            lat,
            17
        );
    }

    updateLocationStatus(
        "success",
        `Joylashuv aniqlandi • aniqlik ±${Math.round(
            cleanPosition.accuracy
        )} m`
    );

    // O‘zimizni users ichida yangilaymiz.
    if (state.userId) {
        const existing =
            state.users.get(
                String(state.userId)
            ) || {};

        state.users.set(
            String(state.userId),
            {
                ...existing,

                id: String(state.userId),

                name:
                    state.userName ||
                    existing.name ||
                    "Men",

                lat,
                lng,

                accuracy:
                    cleanPosition.accuracy,

                isMe: true
            }
        );
    }

    renderMarkers();
    updateMembersUI();

    // Serverga yuborish.
    sendLocationToServer(
        cleanPosition
    );
}


// ============================================================
// GPS ERROR
// ============================================================

function handleLocationError(error) {
    console.error(
        "GPS ERROR:",
        error
    );

    if (!error) {
        updateLocationStatus(
            "error",
            "GPS xatosi yuz berdi."
        );

        return;
    }

    if (error.code === 1) {
        updateLocationStatus(
            "error",
            "Joylashuvga ruxsat berilmagan. Brauzer sozlamasidan Location/Joylashuvni yoqing."
        );

        return;
    }

    if (error.code === 2) {
        updateLocationStatus(
            "error",
            "Telefon GPS signalini topa olmadi. GPS va Location xizmatini yoqing."
        );

        return;
    }

    if (error.code === 3) {
        updateLocationStatus(
            "waiting",
            "GPS javobi kechikmoqda. Yana urinilmoqda..."
        );

        return;
    }

    updateLocationStatus(
        "error",
        "Joylashuvni aniqlashda xatolik yuz berdi."
    );
}


// ============================================================
// SEND LOCATION
// ============================================================

function sendLocationToServer(position) {
    if (
        !state.ws ||
        state.ws.readyState !== WebSocket.OPEN
    ) {
        return;
    }

    if (!state.roomCode) {
        return;
    }

    if (!position) {
        return;
    }

    const payload = {
        type: "location",

        lat: position.lat,
        lng: position.lng,

        accuracy:
            position.accuracy || 0
    };

    try {
        state.ws.send(
            JSON.stringify(payload)
        );
    } catch (error) {
        console.error(
            "LOCATION SEND ERROR:",
            error
        );
    }
}


// ============================================================
// MARKER ELEMENT
// ============================================================

function createMarkerElement(user) {
    const wrapper =
        document.createElement("div");

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

    // Oddiy DOM fallback.
    wrapper.addEventListener(
        "click",
        (event) => {
            event.preventDefault();
            event.stopPropagation();

            centerSelectedUser(
                String(user.id)
            );
        },
        true
    );

    wrapper.addEventListener(
        "pointerup",
        (event) => {
            event.preventDefault();
            event.stopPropagation();

            centerSelectedUser(
                String(user.id)
            );
        },
        true
    );

    return wrapper;
}


// ============================================================
// MARKERS
// ============================================================

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
        console.error(
            "YMapMarker topilmadi"
        );

        return;
    }

    const validIds =
        new Set();

    for (
        const [id, user] of state.users
    ) {
        const userId =
            String(id);

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

        validIds.add(userId);

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
                        String(state.userId)
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

    // Endi users ichida yo‘q markerlarni o‘chiramiz.
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

            state.markers.delete(id);
            state.markerElements.delete(id);
        }
    }
}


// ============================================================
// CENTER SELECTED USER
// ============================================================

function centerSelectedUser(userId) {
    userId =
        String(userId);

    const user =
        state.users.get(
            userId
        );

    if (!user) {
        console.warn(
            "USER NOT FOUND:",
            userId
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

    // Tanlangan markerga highlight.
    for (
        const [
            id,
            element
        ] of state.markerElements
    ) {
        element.classList.remove(
            "selected"
        );
    }

    const selected =
        state.markerElements.get(
            userId
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
// MEMBERS UI
// ============================================================

function updateMembersUI() {
    const list =
        $("membersList");

    if (!list) return;

    list.innerHTML = "";

    const users =
        Array.from(
            state.users.values()
        );

    if (!users.length) {
        list.innerHTML = `
            <div class="empty-members">
                Hozircha guruh a'zolari yo‘q.
            </div>
        `;

        return;
    }

    users.forEach(user => {
        const item =
            document.createElement("div");

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
                    String(user.id)
                );
            }
        );

        item.addEventListener(
            "touchend",
            (event) => {
                event.preventDefault();

                centerSelectedUser(
                    String(user.id)
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
                        String(user.id)
                    );
                }
            }
        );

        list.appendChild(
            item
        );
    });
}


// ============================================================
// USERS FROM SERVER
// ============================================================

function handleUsers(serverUsers) {
    if (!Array.isArray(serverUsers)) {
        return;
    }

    const nextUsers =
        new Map();

    serverUsers.forEach(raw => {
        if (!raw) return;

        const id =
            String(
                raw.id ??
                raw.userId ??
                ""
            );

        if (!id) return;

        const lat =
            Number(
                raw.lat
            );

        const lng =
            Number(
                raw.lng
            );

        const accuracy =
            Number(
                raw.accuracy
            );

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {
            nextUsers.set(
                id,
                {
                    ...raw,
                    id
                }
            );

            return;
        }

        // Serverdagi noto‘g‘ri Afrika koordinatasini
        // ham frontendda ko‘rsatmaymiz.
        if (
            !isInsideUzbekistan(
                lat,
                lng
            )
        ) {
            console.warn(
                "SERVER USER GPS REJECTED:",
                {
                    id,
                    lat,
                    lng
                }
            );

            return;
        }

        nextUsers.set(
            id,
            {
                ...raw,

                id,
                lat,
                lng,

                accuracy:
                    Number.isFinite(
                        accuracy
                    )
                        ? accuracy
                        : 0
            }
        );
    });

    // Agar server bizning yangi GPS joylashuvimizni
    // hali qaytarmagan bo‘lsa, o‘zimiznikini saqlaymiz.
    if (
        state.userId &&
        state.currentPosition
    ) {
        const myId =
            String(
                state.userId
            );

        const myPos =
            state.currentPosition;

        const existing =
            nextUsers.get(
                myId
            );

        if (!existing) {
            nextUsers.set(
                myId,
                {
                    id: myId,

                    name:
                        state.userName ||
                        "Men",

                    lat:
                        myPos.lat,

                    lng:
                        myPos.lng,

                    accuracy:
                        myPos.accuracy,

                    isMe: true
                }
            );
        } else {
            nextUsers.set(
                myId,
                {
                    ...existing,

                    lat:
                        myPos.lat,

                    lng:
                        myPos.lng,

                    accuracy:
                        myPos.accuracy,

                    isMe: true
                }
            );
        }
    }

    state.users =
        nextUsers;

    renderMarkers();
    updateMembersUI();
}


// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHTML(value) {
    return String(value ?? "")
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


// ============================================================
// WEBSOCKET URL
// ============================================================

const WS_URL =
    location.protocol === "https:"
        ? `wss://${location.host}`
        : `ws://${location.host}`;


// ============================================================
// SEND WS
// ============================================================

function sendWS(data) {
    if (
        !state.ws ||
        state.ws.readyState !== WebSocket.OPEN
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
// CREATE / JOIN ROOM
// ============================================================

function createRoom() {
    const nameInput =
        $("nameInput");

    const name =
        String(
            nameInput?.value ||
            ""
        ).trim();

    if (!name) {
        alert(
            "Avval ismingizni kiriting."
        );

        return;
    }

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


function joinRoom() {
    const nameInput =
        $("nameInput");

    const roomInput =
        $("roomInput");

    const name =
        String(
            nameInput?.value ||
            ""
        ).trim();

    const room =
        String(
            roomInput?.value ||
            ""
        ).trim()
            .toUpperCase();

    if (!name) {
        alert(
            "Avval ismingizni kiriting."
        );

        return;
    }

    if (!room) {
        alert(
            "Guruh kodini kiriting."
        );

        return;
    }

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
        state.connected = true;
        state.reconnectAttempts = 0;

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


    state.ws.onmessage = event => {
        let data;

        try {
            data =
                JSON.parse(
                    event.data
                );
        } catch (error) {
            console.warn(
                "SERVER INVALID JSON:",
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


    state.ws.onclose = () => {
        state.connected = false;

        console.warn(
            "SERVER: disconnected"
        );

        scheduleReconnect();
    };


    state.ws.onerror = error => {
        console.error(
            "SERVER ERROR:",
            error
        );
    };
}


// ============================================================
// SERVER MESSAGE
// ============================================================

function handleServerMessage(data) {
    if (!data) return;

    const type =
        data.type;

    // --------------------------------------------------------
    // connected
    // --------------------------------------------------------

    if (
        type === "connected"
    ) {
        if (
            data.userId !== undefined
        ) {
            state.userId =
                String(
                    data.userId
                );
        }

        return;
    }


    // --------------------------------------------------------
    // room-created
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
            ).toUpperCase();

        if (
            data.userId !== undefined
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

        return;
    }


    // --------------------------------------------------------
    // joined-room
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
            ).toUpperCase();

        if (
            data.userId !== undefined
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

        return;
    }


    // --------------------------------------------------------
    // users
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
    // error
    // --------------------------------------------------------

    if (
        type === "error"
    ) {
        console.error(
            "SERVER ERROR:",
            data.message
        );

        alert(
            data.message ||
            "Server xatosi."
        );

        return;
    }


    // --------------------------------------------------------
    // location / user-updated
    // --------------------------------------------------------

    if (
        type === "location" ||
        type === "user-location" ||
        type === "user-updated"
    ) {
        if (
            data.user ||
            data.member
        ) {
            const raw =
                data.user ||
                data.member;

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
                id &&
                Number.isFinite(lat) &&
                Number.isFinite(lng) &&
                isInsideUzbekistan(
                    lat,
                    lng
                )
            ) {
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
            }
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

    console.log(
        `SERVER: reconnect in ${delay}ms`
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
// MY LOCATION BUTTON
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

    // GPS hali yo‘q bo‘lsa,
    // telefondan yangi koordinata so‘raymiz.
    requestCurrentLocation();
}


// ============================================================
// ROOM SWITCH
// ============================================================

function switchRoom() {
    const input =
        $("switchRoomInput");

    if (!input) return;

    const room =
        String(
            input.value || ""
        ).trim()
            .toUpperCase();

    if (!room) {
        return;
    }

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
        $("nameInput");

    if (
        nameInput &&
        savedName
    ) {
        nameInput.value =
            savedName;
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
            centerMyLocation
        );
    }

    if (switchBtn) {
        switchBtn.addEventListener(
            "click",
            switchRoom
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
}

function setupTheme() {
    applyTheme();

    const themeBtn =
        $("themeBtn");

    if (!themeBtn) return;

    themeBtn.addEventListener(
        "click",
        () => {
            state.theme =
                state.theme ===
                "dark"
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
// ENTER KEY
// ============================================================

function setupKeyboard() {
    document.addEventListener(
        "keydown",
        event => {
            if (
                event.key !==
                "Enter"
            ) {
                return;
            }

            const active =
                document.activeElement;

            if (
                active &&
                (
                    active.tagName ===
                    "TEXTAREA"
                )
            ) {
                return;
            }
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
    setupKeyboard();

    await initMap();

    restoreSession();
}


// ============================================================
// START
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    init
);
