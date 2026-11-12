# ΣΝ House TV

A $0, no-subscription TV display for the house. The TV rotates through:

1. **This week's menu**, rebuilt by Gemini into a full-screen TV layout (today's column is highlighted automatically)
2. **A slide** you saved from Google Slides
3. **Your public Google Calendar**, live

You update everything from your phone at `/admin`. The TV checks for changes every minute, so nobody touches the remote.

```
worker/        the website (TV page, phone admin page, Gemini menu reader) — runs free on Cloudflare
firetv-app/    the Fire Stick app (opens the TV page full-screen, starts on boot)
.github/       builds the Fire Stick app for you on GitHub, free
```

---

## What you need (all free)

- A **Cloudflare** account: https://dash.cloudflare.com/sign-up
- A **Gemini API key**: https://aistudio.google.com → "Get API key"
- A **GitHub** account (only to build the Fire Stick app)
- A laptop with **Node.js** installed (https://nodejs.org), for the one-time deploy

---

## Step 1: Put the website online (about 10 minutes, laptop)

Open a terminal in the `worker` folder and run:

```bash
npm install
npx wrangler login                       # opens Cloudflare in your browser, click Allow
npx wrangler kv namespace create TV      # prints an id
```

Open `wrangler.toml` and paste that id where it says `PASTE_YOUR_KV_ID_HERE`. Then:

```bash
npx wrangler secret put GEMINI_API_KEY   # paste your Gemini key
npx wrangler secret put ADMIN_PASSWORD   # make up a password for the upload page
npx wrangler deploy
```

It prints your address, something like `https://frat-tv.yourname.workers.dev`.

- **TV page:** `https://frat-tv.yourname.workers.dev/tv`
- **Phone upload page:** `https://frat-tv.yourname.workers.dev/admin` (add it to your home screen)

## Step 2: Add your content (phone)

Open `/admin` and log in with the password you made.

1. **Weekly menu:** pick the menu image. Gemini reads it (10–30 sec) and shows a preview of the TV version. Fix any typo under "Fix any text," then tap **Put menu on TV**.
2. **Slide:** in Google Slides, File → Download → PNG image. Pick it, then tap **Put slide on TV**.
3. **Calendar:** in Google Calendar on a computer, open Settings → your calendar → turn on **Make available to public**. Under **Integrate calendar**, copy the **Calendar ID**, paste it into the admin page, and tap **Save settings**.

You can also reorder the screens, turn any of them off, and set how many seconds each one shows.

## Step 3: Build the Fire Stick app (GitHub, about 5 minutes)

1. Create a new **public** repository on GitHub and upload this whole folder to it (on github.com: "uploading an existing file," then drag everything in). No passwords or keys are in these files; those live in Cloudflare.
2. Go to the repo's **Actions** tab. Enable workflows if asked, pick **Build Fire TV app**, then **Run workflow**. Paste your TV page address (the `/tv` one) and run it.
3. After about 3 minutes, the **Releases** section of your repo will have `house-tv.apk`. Its download link is
   `https://github.com/YOUR-NAME/YOUR-REPO/releases/latest/download/house-tv.apk`

## Step 4: Install it on the Fire Stick (last time you touch the remote)

1. On the Fire Stick, install **Downloader** from the Appstore (search "Downloader").
2. Allow it to install apps: **Settings → My Fire TV → Developer Options → Install unknown apps → Downloader → On**.
   If you don't see Developer Options, go to **My Fire TV → About** and click the device name 7 times.
3. Open Downloader, type the APK link from Step 3, and install.
4. Open **House TV** once. From then on it starts by itself whenever the stick powers on.

Also turn off the screensaver: **Settings → Display & Sounds → Screensaver → Start Time → Never**.

### Remote controls inside the app
- **Menu (≡) button:** change the page address
- **OK / center button:** refresh now
- **Back:** ignored, so nobody exits by accident (Home still works)

---

## Every week

Open `/admin` on your phone, upload the new menu and/or slide, and tap the button. The TV updates within a minute. The calendar updates on its own.

## If something goes wrong

| Problem | Fix |
|---|---|
| Menu upload says the Gemini model isn't found | Admin → Calendar & rotation → Advanced → put a current model name (e.g. a newer `gemini-…-flash`) and save |
| Calendar slide is blank | The calendar must be **public**. Double-check the Calendar ID. |
| TV shows "Offline" | The stick lost Wi-Fi. It keeps showing the last content and recovers by itself. |
| Want to change how it looks | Menu design: `worker/src/static/menu.css`. TV page: `worker/src/tv.html`. Then run `npx wrangler deploy` again. |

## Costs

Everything here fits in free tiers. Cloudflare Workers + KV free plan: the TV uses about 1,500 requests a day against a 100,000/day limit. The Gemini API free tier covers one menu a week easily, and GitHub Actions is free for public repos.
