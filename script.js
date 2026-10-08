
// ============================================================
// LIVE GPS — SCRIPT.JS
// GURUH KODI + SAQLANGAN GURUHLAR + GPS + YANDEX MAPS
// server.js ga tegilmaydi
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

    locationRequestInProgress: false,

    leavingGroup: false,

    // Yangi:
    // Qaysi guruhga kirish uchun urinish ketayotganini saqlaydi.
    joiningRoom: false
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
// SAVED GROUPS
// ============================================================

function getSavedGroups() {
    try {
        const data =
            JSON.parse(
                localStorage.getItem("gps-saved-groups") || "[]"
            );

        if (!Array.isArray(data)) {
            return [];
        }

        return data
            .map(item => ({
                name: String(item.name || "").trim(),
                code: String(item.code || "")
                    .trim()
                    .toUpperCase()
            }))
            .filter(item => item.code);
    } catch (error) {
        console.warn(
            "SAVED GROUPS READ ERROR:",
            error
        );

        return [];
    }
}


function saveSavedGroups(groups) {
    try {
        localStorage.setItem(
            "gps-saved-groups",
            JSON.stringify(groups)
        );
    } catch (error) {
        console.warn(
            "SAVED GROUPS SAVE ERROR:",
            error
        );
    }
}


function saveCurrentGroup() {
    const code =
        String(
            state.roomCode || ""
        )
            .trim()
            .toUpperCase();

    if (!code) {
        return;
    }

    const name =
        String(
            state.userName || "Guruh"
        ).trim();

    const groups =
        getSavedGroups();

    const index =
        groups.findIndex(
            group =>
                group.code === code
        );

    const item = {
        name:
            name || "Guruh",
        code
    };

    if (index >= 0) {
        groups[index] = item;
    } else {
        groups.unshift(item);
    }

    saveSavedGroups(
        groups.slice(0, 20)
    );

    renderSavedGroups();
}


function removeSavedGroup(code) {
    const normalized =
        String(code || "")
            .trim()
            .toUpperCase();

    const groups =
        getSavedGroups()
            .filter(
                group =>
                    group.code !== normalized
            );

    saveSavedGroups(groups);

    renderSavedGroups();
}


function clearSavedGroups() {
    saveSavedGroups([]);

    renderSavedGroups();
}


function renderSavedGroups() {
    const container =
        $("savedGroups");

    if (!container) {
        return;
    }

    const groups =
        getSavedGroups();

    if (!groups.length) {
        container.innerHTML = `
            <div class="saved-groups-empty">
                Hozircha saqlangan guruh yo‘q.
            </div>
        `;

        return;
    }

    container.innerHTML = `
        <div class="saved-groups-title">
            💾 Saqlangan guruhlar
        </div>

        <div class="saved-groups-list">
            ${groups.map(group => `
                <div
                    class="saved-group-item"
                    data-code="${escapeHTML(group.code)}"
                >
                    <div class="saved-group-info">
                        <div class="saved-group-name">
                            ${escapeHTML(group.name)}
                        </div>

                        <div class="saved-group-code">
                            ${escapeHTML(group.code)}
                        </div>
                    </div>

                    <div class="saved-group-actions">
                        <button
                            type="button"
                            class="saved-group-join"
                            data-action="join"
                            data-code="${escapeHTML(group.code)}"
                        >
                            Kirish
                        </button>

                        <button
                            type="button"
                            class="saved-group-delete"
                            data-action="delete"
                            data-code="${escapeHTML(group.code)}"
                        >
                            O‘chirish
                        </button>
                    </div>
                </div>
            `).join("")}
        </div>
    `;

    container
        .querySelectorAll("[data-action='join']")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    const code =
                        button.dataset.code || "";

                    joinSavedGroup(code);
                }
            );
        });

    container
        .querySelectorAll("[data-action='delete']")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    const code =
                        button.dataset.code || "";

                    removeSavedGroup(code);
                }
            );
        });
}


function joinSavedGroup(code) {
    const normalized =
        String(code || "")
            .trim()
            .toUpperCase();

    if (!normalized) {
        return;
    }

    const roomInput =
        $("roomCode");

    if (roomInput) {
        roomInput.value =
            normalized;
    }

    joinRoom();
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

    updateRoomCodeUI();
    renderSavedGroups();
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
    const el =
        $("currentRoomCode");

    if (el) {
        el.textContent =
            state.roomCode || "------";
    }
}


// ============================================================
// ERROR / STATUS
// ============================================================

function showSetupError(message) {
    const el =
        $("setupError");

    if (el) {
        el.textContent =
            message || "";

        el.classList.toggle(
            "show",
            Boolean(message)
        );
    }
}


function showRoomError(message) {
    const el =
        $("roomError");

    if (el) {
        el.textContent =
            message || "";

        el.classList.toggle(
            "show",
            Boolean(message)
        );
    }
}


function updateLocationStatus(
    type,
    message
) {
    const el =
        $("locationStatus");

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


function updateConnectionUI(
    connected
) {
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
                setTimeout(
                    resolve,
                    200
                )
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

        state.yandexReady =
            true;

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
            YMapDefaultFeaturesLayer
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

        state.mapReady =
            true;

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
        !isInsideUzbekistan(
            lat,
            lng
        )
    ) {
        return false;
    }

    if (
        Number.isFinite(accuracy) &&
        accuracy > 1500
    ) {
        return false;
    }

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

        if (jump > allowed) {
            return false;
        }
    }

    return true;
}


// ============================================================
// GPS
// ============================================================

function requestCurrentLocation() {
    if (!navigator.geolocation) {
        updateLocationStatus(
            "error",
            "Bu qurilmada GPS mavjud emas."
        );

        return;
    }

    if (
        state.locationRequestInProgress ||
        state.leavingGroup
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

            if (!state.leavingGroup) {
                handlePosition(
                    position
                );
            }
        },
        error => {
            state.locationRequestInProgress =
                false;

            if (!state.leavingGroup) {
                handleLocationError(
                    error
                );
            }
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
        state.leavingGroup ||
        !navigator.geolocation
    ) {
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

    requestCurrentLocation();

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


function stopGPS() {
    if (
        state.gpsWatchId !== null
    ) {
        try {
            navigator.geolocation.clearWatch(
                state.gpsWatchId
            );
        } catch (error) {}

        state.gpsWatchId =
            null;
    }

    state.locationRequestInProgress =
        false;
}


function handlePosition(
    position
) {
    if (state.leavingGroup) {
        return;
    }

    if (
        !isGoodGPSPosition(
            position
        )
    ) {
        updateLocationStatus(
            "waiting",
            "GPS signali aniqlanmoqda..."
        );

        return;
    }

    const clean = {
        lat:
            Number(
                position.coords.latitude
            ),

        lng:
            Number(
                position.coords.longitude
            ),

        accuracy:
            Number(
                position.coords.accuracy
            ) || 0,

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

    if (!state.firstGpsFix) {
        state.firstGpsFix =
            true;

        centerMap(
            clean.lng,
            clean.lat,
            17
        );
    }

    updateLocationStatus(
        "success",
        `Aniqlandi ±${Math.round(
            clean.accuracy
        )} m`
    );

    if (state.userId) {
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

                lat:
                    clean.lat,

                lng:
                    clean.lng,

                accuracy:
                    clean.accuracy,

                isMe: true,
                online: true
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
    if (state.leavingGroup) {
        return;
    }

    console.error(
        "GPS ERROR:",
        error
    );

    if (error?.code === 1) {
        updateLocationStatus(
            "error",
            "Joylashuvga ruxsat berilmagan. Locationni yoqing."
        );

        return;
    }

    if (error?.code === 2) {
        updateLocationStatus(
            "error",
            "GPS signal topilmadi."
        );

        return;
    }

    if (error?.code === 3) {
        updateLocationStatus(
            "waiting",
            "GPS javobi kechikmoqda..."
        );

        return;
    }

    updateLocationStatus(
        "error",
        "Joylashuvni aniqlashda xatolik."
    );
}


// ============================================================
// SEND LOCATION
// ============================================================

function sendLocationToServer(
    position
) {
    if (
        state.leavingGroup ||
        !state.ws ||
        state.ws.readyState !== WebSocket.OPEN ||
        !state.roomCode ||
        !position
    ) {
        return false;
    }

    const lat =
        Number(position.lat);

    const lng =
        Number(position.lng);

    const accuracy =
        Number(position.accuracy) || 0;

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return false;
    }

    const payload = {
        type: "location",

        lat,
        lng,

        latitude: lat,
        longitude: lng,

        accuracy
    };

    try {
        state.ws.send(
            JSON.stringify(
                payload
            )
        );

        return true;

    } catch (error) {
        console.error(
            "LOCATION SEND ERROR:",
            error
        );

        return false;
    }
}


// ============================================================
// NORMALIZE USER
// ============================================================

function normalizeUser(
    raw,
    fallback = {}
) {
    if (
        !raw ||
        typeof raw !== "object"
    ) {
        return null;
    }

    const merged = {
        ...fallback,
        ...raw
    };

    const id =
        String(
            merged.id ??
            merged.userId ??
            merged.uid ??
            ""
        ).trim();

    if (!id) {
        return null;
    }

    let lat =
        merged.lat ??
        merged.latitude ??
        merged.location?.lat ??
        merged.location?.latitude;

    let lng =
        merged.lng ??
        merged.lon ??
        merged.longitude ??
        merged.location?.lng ??
        merged.location?.lon ??
        merged.location?.longitude;

    lat =
        Number(lat);

    lng =
        Number(lng);

    let accuracy =
        Number(
            merged.accuracy ??
            merged.location?.accuracy
        );

    const name =
        merged.name ??
        merged.userName ??
        merged.username ??
        merged.displayName ??
        fallback.name ??
        "Foydalanuvchi";

    return {
        ...merged,

        id,

        name:
            String(
                name ||
                "Foydalanuvchi"
            ),

        lat:
            Number.isFinite(lat)
                ? lat
                : null,

        lng:
            Number.isFinite(lng)
                ? lng
                : null,

        accuracy:
            Number.isFinite(accuracy)
                ? accuracy
                : 0,

        online:
            merged.online !== false
    };
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

    wrapper.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();

            centerSelectedUser(
                user.id
            );
        }
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
        const [id, user]
        of state.users
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
            } catch (error) {}

            const element =
                state.markerElements.get(
                    userId
                );

            if (element) {
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

    for (
        const [id, marker]
        of state.markers
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
            } catch (error) {}

            state.markers.delete(id);
            state.markerElements.delete(id);
        }
    }
}


function clearAllMarkers() {
    if (state.map) {
        for (
            const marker
            of state.markers.values()
        ) {
            try {
                state.map.removeChild(
                    marker
                );
            } catch (error) {}
        }
    }

    state.markers.clear();
    state.markerElements.clear();
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
        state.users.get(id);

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

    centerMap(
        lng,
        lat,
        18
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
            String(users.length);
    }

    if (!users.length) {
        list.innerHTML = `
            <div class="empty-members">
                A'zolar kutilmoqda...
            </div>
        `;

        return;
    }

    list.innerHTML = "";

    users.forEach(
        user => {
            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "member-item";

            const isMe =
                String(user.id) ===
                String(state.userId);

            const hasLocation =
                Number.isFinite(
                    Number(user.lat)
                ) &&
                Number.isFinite(
                    Number(user.lng)
                );

            item.innerHTML = `
                <div class="member-avatar">
                    ${escapeHTML(
                        String(
                            user.name || "?"
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
                            hasLocation
                                ? "📍 Joylashuv mavjud"
                                : "⏳ Joylashuv kutilmoqda"
                        }
                    </div>
                </div>
            `;

            item.addEventListener(
                "click",
                () =>
                    centerSelectedUser(
                        user.id
                    )
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
        serverUsers &&
        !Array.isArray(serverUsers) &&
        typeof serverUsers === "object"
    ) {
        serverUsers =
            Object.values(
                serverUsers
            );
    }

    if (
        !Array.isArray(serverUsers)
    ) {
        return;
    }

    const next =
        new Map();

    serverUsers.forEach(
        raw => {
            const normalized =
                normalizeUser(raw);

            if (!normalized) {
                return;
            }

            next.set(
                normalized.id,
                normalized
            );
        }
    );

    // O'z GPSimizni server ma'lumotiga qo'shamiz.
    if (
        state.userId &&
        state.currentPosition
    ) {
        const myId =
            String(
                state.userId
            );

        const old =
            next.get(myId) || {};

        next.set(
            myId,
            {
                ...old,

                id: myId,

                name:
                    state.userName ||
                    old.name ||
                    "Men",

                lat:
                    state.currentPosition.lat,

                lng:
                    state.currentPosition.lng,

                accuracy:
                    state.currentPosition.accuracy,

                isMe: true,
                online: true
            }
        );
    }

    state.users =
        next;

    renderMarkers();
    updateMembersUI();
}


// ============================================================
// LOCATION UPDATE
// ============================================================

function handleIncomingLocation(
    data
) {
    if (!data) {
        return;
    }

    const raw =
        data.user ||
        data.member ||
        data.location ||
        data;

    const fallback = {
        id:
            data.userId ??
            data.id,

        name:
            data.name ??
            data.userName,

        lat:
            data.lat ??
            data.latitude,

        lng:
            data.lng ??
            data.longitude,

        accuracy:
            data.accuracy
    };

    const normalized =
        normalizeUser(
            raw,
            fallback
        );

    if (!normalized) {
        return;
    }

    const lat =
        Number(normalized.lat);

    const lng =
        Number(normalized.lng);

    if (
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
        return;
    }

    state.users.set(
        normalized.id,
        {
            ...normalized,

            lat,
            lng,

            accuracy:
                Number(
                    normalized.accuracy
                ) || 0
        }
    );

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
// CREATE ROOM
// ============================================================

function createRoom() {
    const input =
        $("userName");

    const name =
        String(
            input?.value || ""
        ).trim();

    if (!name) {
        showSetupError(
            "Avval ismingizni kiriting."
        );

        input?.focus();

        return;
    }

    showSetupError("");

    state.leavingGroup =
        false;

    state.joiningRoom =
        false;

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
    const nameInput =
        $("userName");

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

    state.leavingGroup =
        false;

    state.joiningRoom =
        true;

    state.userName =
        name;

    state.roomCode =
        room;

    localStorage.setItem(
        "gps-user-name",
        name
    );

    // Muhim:
    // Eski guruh kodi bilan aralashib ketmasligi uchun
    // aynan hozirgi kod saqlanadi.
    localStorage.setItem(
        "gps-room-code",
        room
    );

    state.pendingAction = {
        type: "join-room",

        // Server versiyalarining turli
        // formatlariga mos.
        room,
        roomCode: room,
        code: room
    };

    console.log(
        "JOIN REQUEST:",
        state.pendingAction
    );

    connectWebSocket();
}


// ============================================================
// WEBSOCKET CONNECT
// ============================================================

function connectWebSocket() {
    if (state.leavingGroup) {
        return;
    }

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

    try {
        const socket =
            new WebSocket(
                WS_URL
            );

        state.ws =
            socket;

        socket.onopen =
            () => {
                if (
                    state.leavingGroup
                ) {
                    try {
                        socket.close();
                    } catch (error) {}

                    return;
                }

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
                    console.log(
                        "SERVER ACTION:",
                        state.pendingAction
                    );

                    sendWS(
                        state.pendingAction
                    );

                    state.pendingAction =
                        null;
                }

                startGPS();
            };


        socket.onmessage =
            event => {
                let data;

                try {
                    data =
                        JSON.parse(
                            event.data
                        );
                } catch (error) {
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


        socket.onclose =
            () => {
                if (
                    state.ws === socket
                ) {
                    state.ws =
                        null;
                }

                state.connected =
                    false;

                updateConnectionUI(
                    false
                );

                if (
                    state.leavingGroup
                ) {
                    return;
                }

                scheduleReconnect();
            };


        socket.onerror =
            error => {
                console.error(
                    "SERVER ERROR:",
                    error
                );
            };

    } catch (error) {
        console.error(
            "WS CREATE ERROR:",
            error
        );

        scheduleReconnect();
    }
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


    if (
        type === "room-created" ||
        type === "room_created"
    ) {
        state.roomCode =
            String(
                data.roomCode ||
                data.code ||
                data.room ||
                ""
            )
                .trim()
                .toUpperCase();

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

        saveCurrentGroup();

        state.joiningRoom =
            false;

        showRoom();
        updateRoomCodeUI();

        startGPS();

        return;
    }


    if (
        type === "joined-room" ||
        type === "joined_room"
    ) {
        state.roomCode =
            String(
                data.roomCode ||
                data.code ||
                data.room ||
                state.roomCode ||
                ""
            )
                .trim()
                .toUpperCase();

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

        saveCurrentGroup();

        state.joiningRoom =
            false;

        showRoom();
        updateRoomCodeUI();

        startGPS();

        return;
    }


    if (
        type === "users" ||
        type === "members"
    ) {
        handleUsers(
            data.users ??
            data.members ??
            data.data ??
            []
        );

        return;
    }


    if (
        type === "location" ||
        type === "user-location" ||
        type === "user_updated" ||
        type === "user-updated" ||
        type === "location-update" ||
        type === "location_updated"
    ) {
        handleIncomingLocation(
            data
        );

        return;
    }


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
            state.joiningRoom &&
            (
                message
                    .toLowerCase()
                    .includes("guruh") ||
                message
                    .toLowerCase()
                    .includes("room") ||
                message
                    .toLowerCase()
                    .includes("kod")
            )
        ) {
            state.joiningRoom =
                false;

            showSetupError(
                message
            );

            // Server rad etgan guruhni
            // avtomatik qayta ulanishga qo'ymaymiz.
            state.pendingAction =
                null;

            if (state.reconnectTimer) {
                clearTimeout(
                    state.reconnectTimer
                );

                state.reconnectTimer =
                    null;
            }

            return;
        }

        showSetupError(
            message
        );

        return;
    }

    console.log(
        "SERVER UNKNOWN MESSAGE:",
        data
    );
}


// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect() {
    if (
        state.leavingGroup ||
        state.joiningRoom
    ) {
        return;
    }

    if (state.reconnectTimer) {
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

                if (
                    state.leavingGroup
                ) {
                    return;
                }

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
        centerMyLocation();
        return;
    }

    let lat = 0;
    let lng = 0;

    users.forEach(
        user => {
            lat +=
                Number(user.lat);

            lng +=
                Number(user.lng);
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

    state.leavingGroup =
        false;

    state.joiningRoom =
        true;

    state.roomCode =
        room;

    localStorage.setItem(
        "gps-room-code",
        room
    );

    state.users.clear();

    clearAllMarkers();

    updateMembersUI();

    state.pendingAction = {
        type: "join-room",
        room,
        roomCode: room,
        code: room
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
// LEAVE GROUP
// ============================================================

function leaveGroup() {
    state.leavingGroup =
        true;

    state.joiningRoom =
        false;

    if (state.reconnectTimer) {
        clearTimeout(
            state.reconnectTimer
        );

        state.reconnectTimer =
            null;
    }

    state.pendingAction =
        null;

    stopGPS();

    clearAllMarkers();

    state.users.clear();

    if (state.ws) {
        try {
            state.ws.close(
                1000,
                "User left group"
            );
        } catch (error) {}
    }

    state.ws =
        null;

    state.connected =
        false;

    state.userId =
        null;

    state.roomCode =
        "";

    state.currentPosition =
        null;

    state.lastGoodPosition =
        null;

    state.firstGpsFix =
        false;

    localStorage.removeItem(
        "gps-room-code"
    );

    const roomInput =
        $("roomCode");

    const switchInput =
        $("switchRoomInput");

    if (roomInput) {
        roomInput.value =
            "";
    }

    if (switchInput) {
        switchInput.value =
            "";
    }

    updateConnectionUI(
        false
    );

    updateRoomCodeUI();

    updateMembersUI();

    showRoomError("");
    showSetupError("");

    updateLocationStatus(
        "waiting",
        "Guruhga kirish uchun tayyor."
    );

    showSetup();

    setTimeout(
        () => {
            $("userName")?.focus();
        },
        100
    );
}


// ============================================================
// COPY
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

    renderSavedGroups();

    if (
        savedName &&
        savedRoom
    ) {
        state.leavingGroup =
            false;

        state.userName =
            savedName;

        state.roomCode =
            savedRoom
                .trim()
                .toUpperCase();

        state.pendingAction = {
            type: "join-room",
            room: state.roomCode,
            roomCode: state.roomCode,
            code: state.roomCode
        };

        state.joiningRoom =
            true;

        showRoom();

        connectWebSocket();

    } else {
        showSetup();
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

    const leaveGroupBtn =
        $("leaveGroupBtn");

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

    if (leaveGroupBtn) {
        leaveGroupBtn.addEventListener(
            "click",
            () => {
                if (
                    window.confirm(
                        "Guruhdan chiqishni xohlaysizmi?"
                    )
                ) {
                    leaveGroup();
                }
            }
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

    await initMap();

    renderSavedGroups();

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
