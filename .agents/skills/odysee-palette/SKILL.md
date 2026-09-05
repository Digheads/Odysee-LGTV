---
name: odysee-palette
description: Design tokens, color palette hierarchy, and styling conventions for Odysee LGTV application (main.css).
---

# Odysee LGTV Color Palette & Design System

This skill defines the standardized color palette and styling conventions for the Odysee LGTV application (`css/main.css`).

> [!IMPORTANT]
> **webOS 2.0+ Compatibility Notice**:
> WebKit 538.2 on legacy webOS devices **does not support CSS variables / custom properties** (`var(--...)`).
> All colors must be declared directly using their exact standardized hex values as listed below. Never introduce arbitrary or fragmented hex variations.

---

## Standardized Color Palette Hierarchy

| Role | Hex Color | Usage & Elements |
| :--- | :--- | :--- |
| **Primary Brand Pink** | `#E2225E` | Active navigation menu item, focused borders/outlines, glowing box-shadows, active setting toggles, comment author names, brand badges. |
| **Gradient Highlight Pink** | `#FF4B72` | Secondary stop for subtle linear gradients on buttons or highlights. |
| **Like / Fire** | `#c91800` | Active like ("fire") button text, icon fill, and stroke. |
| **Dislike / Slime** | `#7BC45E` | Active dislike ("slime") button text, icon fill, and stroke. |
| **Danger / Error / Logout** | `#EF4444` | Player error notifications, Log Out button border & text, destructive actions. |
| **Warm Gold / Accent** | `#FFA855` | Follower count badges, channel stats highlight, and the warm end of the seeker progress bar gradient (`#E2225E -> #FFA855`). |
| **Surface Base** | `#121212` / `#000000` | App canvas background, sidebar background. |
| **Surface Cards & Modals** | `#18191E` | Profile cards, channel headers, comment item backgrounds, focused video cards. |
| **Elevated Surfaces** | `#252830` | Button backgrounds, setting toggle surfaces, login code box, sidebar badges. |
| **Borders & Dividers** | `#2B2D35` | Card outlines, row dividers, sidebar borders, scrollbar thumbs. |
| **Primary Text** | `#FFFFFF` | Headings, card titles, active button text, modal titles. |
| **Secondary Text** | `#9CA3AF` | Setting descriptions, channel stats, metadata, secondary instructions. |
| **Muted Text** | `#6B7280` | Timestamps, inactive hints, subtle sub-labels. |
| **Informational / Pinned** | `#3B82F6` | Pinned comment badges, system notices. |

---

## Critical Styling Rules

1. **Fire vs. Slime**:
   - In Odysee, **Like** is Fire (Red `#c91800`).
   - **Dislike** is Slime (Green `#7BC45E`).
   - Never invert or confuse them.

2. **Single Border Gray**:
   - Always use `#2B2D35` for borders, dividers, and card outlines.
   - Do not reintroduce `#2A2D35`, `#282B34`, `#282B35`, `#23252C`, `#323642`, or `#374151`.

3. **Single Secondary Text Gray**:
   - Always use `#9CA3AF` for subtitles, secondary metadata, and descriptions.
   - Do not reintroduce `#A0A0A0`, `#D1D5DB`, or `#E5E7EB`.

4. **Seeker Progress Gradient**:
   - Standard progress bar gradient is `-webkit-linear-gradient(147deg, #E2225E, #FFA855)` and `linear-gradient(147deg, #E2225E, #FFA855)`.
