# Portal Design System & Pattern Specification

> Source: `https://portal.actcollege.am` — authenticated crawl as `CS0103125` (student role).
> Crawler scope: domain-bound `https://portal.actcollege.am` only, logout/delete excluded, deduplicated SPA routes.
> Visited routes:
> `/login/student`, `/student/dashboard`, `/student/payment` (ACT Balance), `/student/kitchen`, `/student/homework`, `/student/schedule`, `/student/notice` (Notices), `/student/exams`, `/student/bus-tracking`, `/student/support`, `/student/chat`, `/student/settings`.
> Stack signals: Vite SPA (`/assets/index-BWO36fO6.js` + `/assets/index-DClF6Ipp.css` ~178KB), Google Fonts `Montserrat`, Yandex Maps API (bus-tracking), custom CSS Modules (e.g. `._menu_g65zr_1`, `._welcome_mqkeq_1`), `react-datepicker` bundled.
> Artifacts inspected: live DOM + `getComputedStyle`, `:root` vars, full CSS analysis (292× `display:flex`, 14× `display:grid`), 3 screenshots (dashboard, payment, homework).

## 1. Brand & Theme Overview

Dark-first, high-contrast student portal with a lime-on-charcoal “campus fintech” tone. Overall aesthetic: flat dark surfaces, chunky white Montserrat headings, neon lime (`#ACFA00`) as the single action color, sky-blue / gold / red reserved for informational meaning (attendance, coins, alerts). No light mode.

Structural architecture:

- App shell: `.layout { display:flex; height:100dvh; overflow:hidden }` — fixed left sidebar + scrollable right `.page`.
- Sidebar-first navigation (desktop persistent, mobile drawer). No top nav on desktop; sticky blurred `header` only appears ≤800px with hamburger + mobile title.
- Content is card/row-based, not dense enterprise tables: welcome banner + 3 stat cards + 3-col event carousel on dashboard; stacked full-width rows elsewhere (tuition rows, homework accordions, kitchen categories, schedule week grid).
- Iconography: outline/filled SVG nav icons (opacity-driven active state) + playful 3D illustrations on dashboard (graduation cap, diploma, backpack) + donut progress (SVG `transform:rotate(-90deg)`) + large gold ACT Coin medallion.
- Micro-interactions are subtle and consistent: 0.15–0.3s opacity/background transitions, hover lifts (`translateY(-4/-5px)`), calendar `scale(1.05)`, floating “new feature” pill jumping `translateY(0→5px)` infinite, spinner rotations.
- Language: mixed English + Armenian (user name `Գոռ Մադաթյան`, faculty labels). Currency: dram `֏` + internal `ACT Coin` / `Coins`.

## 2. Color System

Root definition (verbatim from `:root` in `index-DClF6Ipp.css`):

```css
:root {
	--white: #ffffff;
	--dark: #272727;
	--white-o: #ffffffb8;
	--black: #000000;
	--green: #acfa00;
	--dark-green: #72a800;
	--green-o: #abfa004d;
	--dark-gray: #373737;
	--gray: #d9d9d9;
	--red: #f90124;
	--orange: #fecb00;
	--blue: #3ec6fd;
	--gray-o: #00000033;
}
```

| Role                       | Visual Sample | Hex Code                          | CSS Variable / Usage                                                                                                          |
| :------------------------- | :------------ | :-------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| Primary Accent             | [Lime]        | `#ACFA00`                         | `var(--green)` — primary buttons (Join Event, Pay, Submit), active nav text, GPA ring, present-day, toggles ON, badges, links |
| Primary Hover / Dark Green | [Dark lime]   | `#72A800`                         | `var(--dark-green)` — hover/darker green variant, text on light                                                               |
| Primary Ghost Tint         | [Lime 8%]     | `#ACFA0014`                       | hard-coded `rgba(172,250,0,.08)` — active pill bg, file-link hover, pending badge bg                                          |
| Primary Wash               | [Lime 30%]    | `#ABFA004D`                       | `var(--green-o)` — green glow shadow `0 8px 20px var(--green-o)`, modal glows                                                 |
| Secondary / Info Blue      | [Sky]         | `#3EC6FD`                         | `var(--blue)` — Telegram CTA `._tg_link`, attendance “attended” ring segment, tournament hover                                |
| Background Canvas          | [Charcoal]    | `#373737`                         | `var(--dark-gray)` — `.page` background, subject blocks, lists, scroll track                                                  |
| Surface Dark               | [Near-black]  | `#272727`                         | `var(--dark)` — sidebar `._menu`, welcome banner, stat cards, event cards, modals, header shadow color                        |
| Surface Overlay White 10%  | [White 6–10%] | `#FFFFFF0F` / `#FFFFFF1A`         | hard-coded — homework rows (`#ffffff0f` → hover `#ffffff1a`), subject rows (`#ffffff1a`)                                      |
| Border / Muted Gray        | [Light gray]  | `#D9D9D9`                         | `var(--gray)` — card borders, input underlines, badge borders, placeholder text                                               |
| Text Primary               | [White]       | `#FFFFFF`                         | `var(--white)` — all headings/body on dark, sidebar profile, table dark-row text                                              |
| Text Muted                 | [White 72%]   | `#FFFFFFB8`                       | `var(--white-o)` — welcome subtitle `._welcome_info p`, scrollbar thumb, arrow-circle bg                                      |
| Text Inverse               | [Black]       | `#000000`                         | `var(--black)` — text on lime/blue buttons, present-day text                                                                  |
| Transparent Black          | [Black 20%]   | `#00000033`                       | `var(--gray-o)` — card shadows `0 4px 10px var(--gray-o)`                                                                     |
| Alert / Absent Red         | [Red]         | `#F90124`                         | `var(--red)` — absent ring, `to-do` badges (`#f901241a` bg), overdue, validation, calendar absent                             |
| Warning / Gold             | [Amber]       | `#FECB00`                         | `var(--orange)` — ACT Coin amount, pending badges, calendar? Fallback `#FB923C` used for optional/repair states               |
| Header Glass               | [Black 40%]   | `#00000066`                       | `#0006` — sticky mobile header `background-color:#0006` + `backdrop-filter:blur(5px)`                                         |
| Modal Scrim                | [Black 75%]   | `#000000BF`                       | `#000000bf` — inventory modal overlay + `blur(4px)`, `z-index:1000`                                                           |
| Datepicker Blues           | [Blue]        | `#216BA5` / `#1D5D90` / `#4B7BEC` | bundled `react-datepicker` selected/range states (not brand, do not reuse)                                                    |
| Neutral Fills              | [Light]       | `#F0F0F0` / `#CCCCCC` / `#AEAEAE` | datepicker in-range, disabled, secondary text                                                                                 |

Opacity scale observed in CSS (for recreating tints): `...0A` (4%), `...14` (8%), `...1A` (10%), `...26` (15%), `...40` (25%), `...4D` (30%), `...59/73` (35–45%), `...B8` (72%).

## 3. Typography & Hierarchy

- **Font Family Primary:** `Montserrat, sans-serif` — loaded via `https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap`. No secondary serif/mono. `body { font-family:Montserrat,sans-serif; background:rgb(55,55,55); color:#000 }` but all content overrides to white.
- **Weights in use (by frequency in CSS):** `700` (77× — headings/buttons/badges), `600` (76× — sidebar names, nav, card titles), `500` (45× — body emphasis, pills, links), `400` (11× — body), `100` (error text only).
- **Type Scale:**
  - `H1`: none in app (login hero uses `H2 80px/70px/700` + `span 80px/400`; login form `H3 48px/100%/700`, 35px ≤400px)
  - `H2`: `32px / 700 / normal` white — e.g. `Welcome back, …!`, `ACT balance`, `Schedule`, `Homeworks`, `Exams`, `Chat`. Section variant `28px/26px/700` for `Events`. `20–24px` for modal titles.
  - `H3`: `30px / 700` white (header `header h3`), `24px / 700` white (stat cards `GPA/Attendance/ACT Coin`, tuition rows), sidebar profile `24px/600` + sub `16px/400`
  - `H4`: `16px / 700` white — event meta, GPA detail, sidebar labels
  - `Body`: `14px / 400 / 140% (19.6px)` white centered in sidebar, left in cards; welcome subtitle `16px/400` `var(--white-o)`
  - `Small / Label`: `13px / 500` dark-on-pill or gray (`a:13px/500 #272727`, Telegram link `13px/500`)
  - `Caption / Badge`: `12px` (inputs, deadlines, inventory), `11px/700` (count pills `to-do/done/optional`), `10px/700` (pill count bubble `18px` circle)
  - `Button`: `16px / 700` (event/primary), `13px / 500–600` (ghost/toggle/pill), login submit `16px/400`
- **Element mappings:** `h2` = page title; `h3` = card title / tuition line / user name; `h4` = sub-fact; `p` = description/meta; `a` = green file links + blue Telegram CTA; `span` = badge/count.
- **Line-height:** headings `100%–140%` or `26px` fixed for events; body `140–170%` (`1.7` for homework desc `white-space:pre-wrap`).

## 4. Spacing & Elevation

- **Spacing Scale:** 4px base. Observed paddings (most common first): `2px 8px` (21× badges), `20px` (17×), `0` (14×), `10px` (13×), `12px` (12×), `6px 14px` (11× pills), `7px 16px` (10× ghost buttons), `10px 14px` (9× toggles), `3px 10px` (9× tags), `5px 14px` (9×), `14px 20px` + `16px 20px` (rows), `12px 16px` (inputs), `12px 24px` (login submit), `40px` (sidebar + `.page`), `50px 0 20px 20px` (nav stack), `120px 70px` (login split). Gaps: `flex gap 4/6/8/10/12/14/16/18/20/30px`; `grid gap 6px` (calendar) / `20px` (events/dashboard).
- **Layout containers:** `.page { flex:1; padding:40px; overflow-y:scroll; background:var(--dark-gray) }` → `padding:30px` ≤1200px. Sidebar `width:280px; padding:40px; gap:30px`. Welcome banner `height:260px; padding:10px 60px 10px 10px; inner 20px 0 20px 20px`. Cards `12px 12px 30px` (stats) / `12px 16px` / `18px` / `20px` + `24px` (score popovers `min-width:300px; max-height:85dvh`).
- **Shadows / Elevation:**
  - `header: 0 0 5px 0 var(--dark)` + glass blur
  - `card subtle: 0 0 4px 0 var(--white-o)` / `0 4px 10px var(--gray-o)` / `0 4px 12px #0000004d`
  - `popover/modal: 0 8px 40px #0009` / `0 6px 20px #0006` / `0 4px 20px #0000004d`
  - `brand glow: 0 8px 20px var(--green-o)` / CTA `0 4px 12px #0000004d`
  - `score card: 0 0 5px 0 var(--gray)` on `bg:var(--dark-gray)`
  - No Tailwind-style `sm/md/lg` elevation scale — 2 levels: flat rows (no shadow) vs. lifted modals/popovers.
- **Border Radius:** dominant `8px` (76× — buttons, inputs, toggles, table wrap), `6px` (42× — calendar days, file links), `12px` (30× — cards, lists, subject blocks), `20px` (28× — pills/count badges), `10px` (27× — pay options, dropzones), `50%` (22× — avatars, donut, arrow circles, spinner), `5px`/`4px` (secondary), `15px`/`16px` (add-coins/inventory modals), `30px` (floating new-feature pill), `1rem` (datepicker). Buttons: primary `0px` (dashboard Join Event computed) to `8–10px` elsewhere — normalize to `8px`.
- **Borders:** `1px solid var(--gray)` (cards/inventory), `1px solid rgba(217,217,217,.2–.25)` (ghost/pills/dropzone), `1px solid rgba(255,255,255,.06)` (homework dividers), `2px dashed rgba(217,217,217,.2)` (dropzone), `9px solid var(--white)` (sidebar avatar frame), `bottom:1px solid var(--gray)` (login inputs), `1px solid var(--green)` + tinted bg (active states).
- **Responsive Breakpoints (from `@media` counts):** `1400px` (1×), `1200px` (9× — hide welcome illustration/login image, page padding 40→30), `1100px` (5×), `1000px` (6× — dashboard stack column, events desktop→mobile, layout height auto), `900px` (2×), `800px` (10× — header show, sidebar → fixed drawer `left:-100%→0`, welcome height auto), `750px` (1× — map aspect `5/6`), `700px` (12× — homework wrap), `600px` (8× — payment table `13px`, pills scroll), `560/500/480/420/400px` (fine-tuning).
- **Scrollbar:** `::-webkit-scrollbar { width:8px } track:var(--dark-gray) radius 4px thumb:var(--white-o)→hover var(--white); * { scrollbar-width:thin; scrollbar-color:var(--white-o) var(--dark-gray) }`.

## 5. UI Component Library

### 5.1 Buttons

- **Primary Button:** Lime block. Example: `Join Event` / `Pay` / modal `Submit`.
  ```html
  <button class="_event _payOption">Join Event</button>
  ```
  ```css
  background: var(--green);
  color: var(--dark);
  padding: 12px;
  border: none;
  border-radius: 8px; /* 0px on dashboard carousel, normalize to 8px */
  font: 700 16px/26px Montserrat;
  text-align: center;
  cursor: pointer;
  transition:
  	background-color 0.3s,
  	opacity 0.2s;
  &:disabled {
  	opacity: 0.5;
  	cursor: not-allowed;
  }
  /* pay variant: border-radius:10px; font-weight:500; flex:1; flex-direction:column; gap:6px */
  ```
  Computed sample: `rgb(172,250,0) / rgb(39,39,39) / 12px / 16px/700`.
- **Secondary / Dark Button:** `Read More` (`._more`: `background:var(--dark-gray); color:var(--white)` same padding/font as primary, `margin-top:auto` in cards).
- **Ghost Button:** Filter/toggles (`Past →`, `Main/Extra`, `Upcoming & Ongoing`).
  ```css
  background: transparent;
  color: var(--gray);
  border: 1px solid rgba(217, 217, 217, 0.25);
  padding: 7px 16px;
  border-radius: 8px;
  font: 500 13px Montserrat;
  &:hover:not(:disabled) {
  	border-color: var(--white);
  	color: var(--white);
  }
  &.active {
  	background: #acfa0014;
  	border-color: rgba(172, 250, 0, 0.4);
  	color: var(--green);
  	font-weight: 600;
  }
  ```
- **Pill Button:** Homework/subject filters + Kitchen categories (`Food/Drinks/Sauces/Coffee & Tea/Sweets/Salads`).
  ```css
  display: inline-flex;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid rgba(217, 217, 217, 0.2);
  color: var(--gray);
  font: 500 13px;
  &.active {
  	border-color: var(--green);
  	background: #acfa001a;
  	color: var(--green);
  	font-weight: 700;
  }
  .badge {
  	width: 18px;
  	height: 18px;
  	border-radius: 50%;
  	background: var(--green);
  	color: var(--dark);
  	font: 700 10px;
  }
  .badge.urgent {
  	background: var(--red);
  	color: #fff;
  }
  ```
- **Telegram CTA:** Single blue link-button in welcome banner.
  ```css
  display: inline-flex;
  gap: 7px;
  background: var(--blue);
  color: var(--dark);
  padding: 8px 16px;
  border-radius: 8px;
  font: 500 13px;
  text-decoration: none;
  &:hover {
  	color: var(--black);
  }
  ```
- **Login Submit:** `padding:12px 24px; border-radius:8px; background:var(--white); color:var(--dark); font:400 16px` + spinner `14px` border `1px solid var(--dark)` with `border-bottom-color:transparent` rotating.
- **Icon Buttons:** `background:transparent; border:none` (header hamburger, avatar edit `opacity:0→1` on hover, calendar arrows `50px` circle `bg:var(--white-o)`).
- **Floating CTA:** `._newFeatureBtn { position:fixed; bottom:20px; left:50%; transform:translate(-50%); padding:12px 20px; border-radius:30px; background:var(--green); font-weight:700; box-shadow:0 4px 12px #0000004d; animation:jumping 1s infinite }`.

### 5.2 Forms & Inputs

- **Login Field (underline style, login only):**
  ```css
  input {
  	all: unset;
  	box-sizing: border-box;
  	width: 100%;
  	max-width: 400px;
  	border-bottom: 1px solid var(--gray);
  	padding: 12px 35px 12px 20px;
  	color: var(--white);
  }
  input::placeholder {
  	color: var(--gray);
  	font: 400 16px;
  }
  .error {
  	color: tomato;
  	font-weight: 100;
  }
  .forgot {
  	background: transparent;
  	color: var(--gray);
  	font: 400 16px;
  }
  .forgot:hover {
  	text-decoration: underline;
  }
  ```
- **App Field (boxed style, settings/add-coins/support/chat):** computed on `settings input[type=password]`:
  ```css
  background: rgb(55, 55, 55); /* var(--dark-gray) */
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 8px;
  padding: 12px 16px;
  outline: none;
  /* add-coins variant: background:var(--dark); color:var(--dark)? actually white-on-dark; padding:10px; border-radius:10px; text-align:right; border:none */
  ```
- **Selects / Datepicker:** native `button,select,option{cursor:pointer}` + `react-datepicker` theme (selected `#216ba5`, hover `#1d5d90`, in-range `#f0f0f0`, highlight `#32be3f`). Keep native arrow, Montserrat 13–14px.
- **Checkboxes:** `input[type=checkbox]{width:16px;height:16px;accent-color:var(--green);flex-shrink:0}` inside `label{font:13px white; gap:10px}` + contract box `bg:var(--dark); border:1px solid var(--gray); radius:8px; padding:12px; max-height:180px; overflow-y:auto`.
- **Toggle Switch:** `40×22px pill`:
  ```css
  .toggle {
  	width: 40px;
  	height: 22px;
  	border-radius: 11px;
  	background: var(--dark-gray);
  	border: none;
  	transition: background 0.2s;
  }
  .toggle.on {
  	background: var(--green);
  }
  .knob {
  	width: 16px;
  	height: 16px;
  	border-radius: 50%;
  	background: var(--white);
  	top: 3px;
  	left: 3px;
  	transition: transform 0.2s;
  }
  .on .knob {
  	transform: translateX(18px);
  }
  .state {
  	font: 700 12px var(--gray);
  }
  .state.on {
  	color: var(--green);
  }
  .wrap {
  	display: flex;
  	gap: 10px;
  	padding: 10px 14px;
  	border: 1px solid var(--gray);
  	border-radius: 10px;
  	cursor: pointer;
  }
  ```
- **File Dropzone (homework submit):**
  ```css
  border: 2px dashed rgba(217, 217, 217, 0.2);
  border-radius: 10px;
  padding: 18px 20px;
  color: var(--gray);
  font: 13px;
  text-align: center;
  &:hover {
  	border-color: #acfa0066;
  	background: #acfa0008;
  	color: var(--white);
  }
  &.filled {
  	border-color: #acfa0066;
  	background: #acfa000a;
  }
  .clear {
  	background: transparent;
  	border: none;
  	color: #f9012499;
  	font: 12px;
  }
  .clear:hover {
  	color: var(--red);
  }
  ```
- **Validation:** error text `tomato`, overdue `var(--red) 13px/500`, `not-required` orange `#fb923c`, instructor comment `13px white` with `10px/700 uppercase gray` label, submitted block `bg:#acfa000a; border:rgba(172,250,0,.15); radius:8px; padding:12px 14px`.

### 5.3 Cards & Containers

- **Stat Cards (dashboard):** `._statics_gpa/attend/coins { flex:3 (attend flex:5, 3 ≤1200px); background:var(--dark); padding:12px 12px 30px; display:flex; column; align-items:center } h3{24px/700 white flex-start} p{20px/500 var(--orange) margin-bottom:30px} :last-child{margin-top:auto}` + info `i` icon `absolute top:20 right:20 cursor:pointer` opening popover `bg:var(--dark-gray); padding:24px; radius:12px; shadow:0 0 5px var(--gray); min-width:300px; max-height:85dvh`.
- **Event Cards:** desktop `grid 3 cols gap:20px`; card `bg:var(--dark); padding:12px; flex column gap:10px; img{aspect-ratio:1/1; object-fit:cover} p{aspect-ratio:1/1; overflow-y:auto; 18px white} h3/h4{16px/26px/700} span{16px/26px/600 green center}`; mobile `flex overflow-x:auto min-width:260px max-width:260px`.
- **Tuition Rows + Payment Table (payment):** rows `bg:var(--dark)` (near-black) full-width, `Tuition: ֏ 0` left `18–20px/700` + `Paid✅` right green; total `Total: -1980 Coins` white/700; table `header white bg dark text (th{color:var(--dark)})`, body dark rows white text, `1px` grid borders, `font 14px` (13px ≤600px), last col center with gold `Ⓞ` status icon, `#1` / `Sep 09,15:08` / `Boom ×1` / `200` pattern.
- **Homework Accordion:** container `bg:var(--dark-gray); radius:12px`; subject row `bg:#ffffff1a; padding:16px 20px; flex space-between; name 16px/700 white ellipsis; meta badges`; hw row `bg:#ffffff0f; padding:14px 20px; min-height:56px; hover:#ffffff1a`; body `padding:4px 20px 20px; desc 14px/1.7 pre-wrap`; chevron `7px` borders `2px gray rotate(-45deg)` → open `rotate(45deg) white`; tags: `subject_tag bg:green dark 12px/700 padding:3px 10px radius:20px max-width:130px`, `cls_tag green-tint border`, `deadline 12px gray (red if overdue)`, badges `11–12px/700 radius:20px padding:2px 8px` (todo red, pending yellow, done green, optional/repair orange, approved green-outline, rework red).
- **Inventory / QR Cards:** `bg:var(--dark-gray); border:1px solid var(--gray); radius:12px; padding:12px 16px; flex gap:14px; qr 56×56 radius:8px cover; name 14px/700 white; id 11px gray; loc 12px gray; status 12px green (repair orange); approve btn green 13px/700 padding:6px 16px radius:8px`.
- **Modals:** overlay `fixed inset 0 bg:#000000bf blur(4px) z:1000 flex center padding:16px`; card `bg:var(--dark-gray); border:1px solid var(--gray); radius:16px; padding:28px 24px; max-width:480px (350px add-coins); max-height:80vh; overflow-y:auto; flex column gap:16px`; title `20px/700 white`, sub `14px gray`; add-coins variant `bg:var(--dark); radius:15px; padding:20px; input radius:10px; button green radius:10px padding:10px`.
- **Badges / Chips:** all `font:700 11–12px; padding:2px 8px; radius:20px; border:1px solid` with tinted bg (see 5.1). Calendar days `40×40 radius:6px 14px/500` (`present:green/black`, `absent:red/white`, `weekend:gray/black`, `empty:transparent`).
- **Chat/Support:** subject blocks `hover:translateY(-5px)` + message bubbles (no custom bg observed, dark default); support `new` dot on nav.

### 5.4 Navigation Systems

- **Sidebar (`._menu 280px`):** `width:280px; display:inline-flex; column; background:var(--dark); padding:40px; height:100%; overflow-y:scroll; position:relative`. Profile: avatar `width:80% max-250px aspect:1/1 bg:var(--gray) border:9px solid var(--white) object-fit:cover` + hover edit button; name `24px/600 center white margin-top:15px`; meta `16px/600 (400 for values)` + `p 14px/140% white nowrap` (ID/Faculty `Computer Science`/Group `CS-11A`). Nav: `flex:1 column align-start gap:30px padding:50px 0 20px 20px` (30px 20px ≤800px). Link: `display:inline-flex; gap:12px; background:transparent; border:none; cursor:pointer; span{16px/600 white opacity:.5 transition:.3s} svg{fill-opacity:.5;stroke-opacity:.5} :hover/active span{opacity:1} :active svg{fill-opacity:1} .green{color:var(--green);opacity:1}`. Order: Dashboard, ACT Balance, Kitchen, Homework, Schedule, Notices, Exams, Bus Tracking, Support+`new`, Chat, Settings, Logout (excluded from crawl). Close btn hidden desktop, `absolute right:30 top:35` mobile.
- **Mobile Header:** `display:none` desktop → `flex space-between` ≤800px; `position:sticky; top:0; z-index:2; padding:16px 24px; background:#0006; backdrop-filter:blur(5px); box-shadow:0 0 5px var(--dark); transition:transform .5s; h3{30px white} button{transparent border:none}` + `.hidden{transform:translateY(-100%)}` on scroll.
- **Mobile Drawer:** ≤800px sidebar `position:fixed; left:-100%; transition:.3s; width:100%; top:0; z-index:10; align-items:center` + `.active{left:0}`.
- **Breadcrumbs / Footer:** none. Page titles are `H2` at top of `.page` + ghost `Past →` / `Main|Extra` / `Upcoming & Ongoing|Show Previous` toggles on right (`._header {flex space-between wrap gap:12px margin-bottom:20px}`).
- **Active Tab Styling:** nav opacity 1 + (optional) green text; homework/kitchen pills green border + tinted bg; schedule/exams ghost active same pattern.

## 6. Page Layout Archetypes

- **Dashboard Grid:** `.page` (40px) → `._welcome {flex:4; height:260px; bg:var(--dark); flex space-between center; padding:10px 60px 10px 10px}` (left: date `16px white-o` + `h2 32px/700` + sub + blue Telegram link; right: `width:40% img contain`, hidden ≤1200px) → `._statics {flex gap:20px padding:20px 0; column ≤1000px}` (GPA flex:3 + Attendance flex:5 + ACT Coin flex:3, donut `rotate(-90deg)` center text `700 white`, coin `+` top-right) → `My Items` + `Events h2 28px` → desktop `grid repeat(3,1fr) gap:20px` with absolute `50px` circle arrows (`bg:var(--white-o)`), mobile `flex overflow-x:auto`. Recreation: `grid-cols-1 lg:grid-cols-[1fr_1.6fr_1fr]` for stats, `md:grid-cols-3` for events.
- **Table / List View:** Payment: `h2 32px` + 3 tuition banner rows (full-width dark, space-between) + `Total` line + `paymentTable` (white thead, dark tbody, bordered cells, responsive 13px). Homework: `h2 + Past ghost` header + stacked `subject_block` accordions (full-width, 8px gap) each expanding to `hw_item` rows + `hw_body` forms. Kitchen: category pills row (scroll ≤600px `scrollbar-width:none`) + food `grid` (implied) + basket popover `top:120px ≤800px` with `span bg:#ff4d4f` count. Schedule: `Main|Extra` ghost + weekday `grid` (Mon–Fri repeated) + class rows. Notices/Exams: `Upcoming & Ongoing` ghost + event-card grid. Support/Chat: ticket/subject list + detail pane + bottom input. Settings: profile header + `Change Password` (3 password inputs + green submit) + FAQ accordions (`Student/Instructor/General`) + `Changelog/Coming soon`.
- **Auth Split:** `._login {height:100dvh; flex center; bg:var(--dark)} form{padding:120px 70px; flex:1; column center; h3 48px; p 16px/500 gray; form{max-width:400px; gap:16px; padding:50px 0 120px}} image{flex:1; padding:120px 70px; bg:url(/images/portal.jpg) cover center; h2 80px/70px}` hidden ≤1200px. Single-column centered ≤1200px.
- **Modal / Overlay:** All details (GPA breakdown, attendance calendar `grid 7 cols gap:6px max-width:400px bg:dark-gray padding:20px radius:12px`, deposit, inventory contract, add-coins) use centered fixed overlay + `max-width:350–480px` card (see 5.3). Calendar legend via bg colors, not text.
- **Map View (bus-tracking):** Yandex map container `.yandexMap {aspect-ratio:5/6 ≤750px}` full-bleed in `.page`, no custom controls observed.

## 7. Recreation Guidelines for Developers

Tailwind-ready tokens + notes (use CSS vars or `tailwind.config` extend):

```js
// tailwind.config.js
theme:{extend:{
  colors:{
    brand:{DEFAULT:'#ACFA00', dark:'#72A800', wash:'#ABFA004D', tint:'rgba(172,250,0,0.08)'},
    ink:{DEFAULT:'#272727', canvas:'#373737', black:'#000000'},
    paper:{DEFAULT:'#FFFFFF', muted:'rgba(255,255,255,0.72)'},
    line:'#D9D9D9', info:'#3EC6FD', danger:'#F90124', warn:'#FECB00', warnAlt:'#FB923C',
  },
  fontFamily:{sans:['Montserrat','system-ui','sans-serif']},
  borderRadius:{DEFAULT:'8px', sm:'6px', lg:'12px', pill:'20px', full:'50%'},
  boxShadow:{
    header:'0 0 5px 0 #272727', card:'0 4px 12px rgba(0,0,0,0.3)',
    modal:'0 8px 40px rgba(0,0,0,0.6)', glow:'0 8px 20px rgba(171,250,0,0.3)',
  },
  screens:{xs:'400px', sm:'600px', md:'800px', lg:'1000px', xl:'1200px'},
}}
```

- **Shell:** `div.flex.h-[100dvh].overflow-hidden > aside.w-[280px].bg-ink.p-10.flex.flex-col.overflow-y-auto + main.flex-1.bg-ink-canvas.p-10.max-xl:p-[30px].overflow-y-auto`. Mobile: `aside.fixed.-left-full.transition[.3s].w-full.z-10.items-center.md:static` + `header.sticky.top-0.z-2.hidden.max-md:flex.justify-between.p-[16px_24px].bg-black/40.backdrop-blur-[5px]`.
- **Type:** set `body{font-family:Montserrat}`. Page title `text-[32px] font-bold text-white`; card title `text-2xl font-bold`; body `text-sm leading-[140%] text-white`; badge `text-[11px] font-bold px-2 py-0.5 rounded-[20px] border`.
- **Buttons:** primary `bg-brand text-ink font-bold text-base px-3 py-3 rounded-lg hover:brightness-95 disabled:opacity-50`; ghost `border border-white/20 text-[#d9d9d9] text-[13px] font-medium px-4 py-[7px] rounded-lg hover:border-white hover:text-white data-[active]:border-brand data-[active]:text-brand data-[active]:bg-brand/10`; pill `rounded-[20px] px-[14px] py-[6px] text-[13px]`; blue CTA `bg-info`.
- **Inputs:** app style `bg-[#373737] border border-white/70 rounded-lg px-4 py-3 text-white placeholder:text-[#d9d9d9] focus:border-brand focus:outline-none`; login style `border-b border-[#d9d9d9] px-5 py-3`; checkbox `accent-[#ACFA00] w-4 h-4`; toggle custom `w-10 h-[22px] rounded-full` + knob `w-4 h-4`.
- **Cards/rows:** stat `bg-ink p-3 pb-[30px] flex flex-col items-center`; row `bg-white/10 hover:bg-white/10 rounded-xl px-5 py-4` (use `bg-[#ffffff0f]`); divider `border-white/5`; table `thead:bg-white text-ink tbody:bg-ink text-white [&_td]:border [&_th]:border`.
- **Do / don’t:** DO keep single lime action color — map blue only to Telegram/attendance, gold only to coins, red only to destructive/absent. DO use `gap` (not margins) for stacks, `40px` page padding desktop. DON’T introduce light mode or extra fonts. DON’T use default blue links — file links are `text-brand underline-offset-2 border border-brand/30 rounded-md`. DON’T add heavy shadows — portal is flat except modals. Respect `prefers-reduced-motion` for jumping CTA/spinners.
- **A11y/perf:** ensure `contrast( #ACFA00 on #272727 )` for buttons passes; keep focus-visible outlines (currently `outline:none` on some inputs — add `focus-visible:ring-2 ring-brand`); lazy-load event images (`aspect-square object-cover`); keep Yandex Maps + datepicker chunks code-split.
