# Odysee webOS Client for LG Smart TVs – Technical Overview & Compatibility Report

## 1. Project Overview
**Odysee-LGTV** is a lightweight, high-performance client for Odysee / LBRY tailored specifically for LG webOS Smart TVs, supporting legacy devices (webOS 2.0+) up to modern webOS platforms (webOS 24+).

The architecture is deliberately built without heavyweight modern frameworks (no React, no Vue, no bundler overhead). It operates directly as an ultra-fast, low-memory web application packageable into a native webOS `.ipk`.

### Core Technical Foundations:
- **Language & Runtime**: Strict **ES5 Vanilla JavaScript** (ensuring 100% execution compatibility on ancient WebKit engines in webOS 2.0; no ES6 `let`/`const`, arrow functions, `Promise`s, template literals, or optional chaining).
- **Styling & Layout**: Vanilla CSS with a consolidated design system, optimized for 1080p TV viewing (10-foot UI design, high contrast, smooth focus highlights, unified grid layout).
- **Navigation Engine**: Dedicated D-Pad spatial navigation (`SpatialNavigation`) designed for both conventional TV remotes and LG Magic Remotes (Arrow keys, OK/Enter, Back button with proper history stack handling, Red/Green/Yellow/Blue color buttons, and Play/Pause/Rewind/Fast-Forward media keys).

---

## 2. Key Features & Architecture
- **OAuth 2.0 Device Code Flow (`Auth`)**: Keycloak SSO integration (`odysee.com/$/activate`) matching the official Roku client, automatic token persistence and refresh cycles, user profile metadata, custom avatars, and follower counts.
- **Content Discovery & Feeds**:
  - *Trending feed* and dynamic resolution of *15 Odysee categories* (`$/api/content/v2/get`).
  - Full-text *Lighthouse search* hydrated via Hub SDK JSON-RPC (videos and channels).
- **User Library & Social Interactions**:
  - *Following feed*: Aggregation of latest uploads from followed channels.
  - *Playlists*: Seamless sync with Odysee cloud preferences (`builtInCollections` for Watch Later & Favorites, private unpublished playlists, and published channel collections).
  - *Channel Pages*: Complete channel view displaying avatars, subscriber counts, total uploads, and instant Follow/Unfollow toggles synced to cloud preferences.
  - *Social Engagement*: LBRY Commentron comment threads and reactions (Like/Dislike).
- **Video Playback Engine (`Player`)**:
  - Custom full-screen OSD (progress bar, dual scrubbing: hold-to-scrub & percentage-based seek, time remaining).
  - In-player Related Videos Shelf.
  - Resume video.
  - Proactive 30-second watchdog timer to detect and automatically recover stalled hardware video buffers.
  - Telemetry reporting to Odysee Watchman (`watchman.na-backend.odysee.com`).

---

## 3. Video Playback & webOS Version Compatibility Matrix

Smart TVs present significant fragmentation across browser engines (WebKit vs. Chromium) and hardware video decoders. The player uses standard HTML5 `<video>` elements with dual resolution (Hub SDK `streaming_url` with direct CDN fallback).

| webOS Version | Release Years | Engine / Browser Core | Playback Status | Supported Formats & Constraints |
| :--- | :--- | :--- | :--- | :--- |
| **webOS 1.x – 2.x** | 2014 – 2015 | WebKit 537 / 538 | **Supported (with constraints)** | • **Strict ES5 only**; any ES6 token causes parse crash.<br>• **Progressive MP4 (H.264 / AAC)** up to 1080p@30/60fps plays natively.<br>• MSE (MediaSource Extensions) is unavailable or incomplete; modern HLS.js cannot run, relying entirely on the native webOS HLS pipeline.<br>• **No VP9 / AV1 hardware acceleration** (H.264 only).<br>• Outdated root CA store: older models may require system time sync or proxying for recently expired root certificates (e.g. Let's Encrypt ISRG Root X1). |
| **webOS 3.x** | 2016 – 2017 | Chromium 38 | **Well Supported** | • Stable native MP4 and HLS pipelines.<br>• Hardware H.264 decoding (4K H.264/HEVC on 4K hardware).<br>• Watchdog timer is essential: network buffer stalls occasionally freeze the hardware pipeline without firing standard HTML5 `error` events. |
| **webOS 4.x** | 2018 – 2019 | Chromium 53 | **Fully Supported** | • Stable MSE implementation, improved memory management, reliable networking.<br>• Hardware VP9 decoding introduced on most models. |
| **webOS 5.x – 6.x** | 2020 – 2021 | Chromium 68 / 79 | **Optimal** | • Modern Chromium engine with fast flex/grid CSS rendering.<br>• AV1 hardware decoding on compatible 2020+ chips. |
| **webOS 22, 23, 24+** | 2022 – 2026 | Chromium 87 – 108+ | **Flawless** | • Modern web standards compliance, stable 60fps UI, full HTML5 video event support. |

---

## 4. Current Limitations & Known Gaps

### 1. Playback & Quality Selection
- **No Manual Multi-Bitrate Selector (VOD)**:
  - The player currently requests the primary stream URL or direct MP4 CDN source. There is no manual quality picker UI (e.g., 360p / 720p / 1080p), meaning connections with severe bandwidth throttling cannot be manually downgraded to lower bitrates.
- **Watchdog Recovery on Poor Connections**:
  - The 30s watchdog automatically restarts the stream if playback freezes. On severely unstable networks, this may lead to repeated buffering/restart cycles instead of reducing video quality.

### 2. Live Streaming
- Live stream claims are detected and viewer counts / live chat can be accessed, but low-latency live HLS streaming and live time-shifting (DVR scrubbing) are limited compared to standard VOD playback, especially on older webOS 2/3 devices.

---

## 5. Summary for Reviewers
- Validated with `ares-package` with zero compilation errors.
- Strictly compliant with low-resource embedded TV requirements (ES5 runtime, zero npm runtime dependencies, low RAM usage).
- Core user journeys (Browse, Search, Device Login, Playback with OSD, Speed Control, Playlists, Channel subscriptions) have been verified on real TV hardware.
