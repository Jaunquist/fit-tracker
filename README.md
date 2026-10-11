# Fit Tracker

A personal food, weight, sleep and activity tracker that installs on your phone like an app.

- **App:** this repo, served by GitHub Pages
- **Data:** your own Google Sheet
- **Back end:** one Google Apps Script file inside that Sheet (`apps-script/Code.gs`)
- **Food scanning and report summaries:** Google Gemini, called from the script

No keys, PINs or personal data belong in this repo. They live in the Sheet's script.

## What is in here

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Make it installable and able to open offline. `icon-maskable-*` are the full-bleed versions Android crops to its own shape |
| `apps-script/Code.gs` | Back end. Paste into the Sheet's Apps Script editor; GitHub does not run it |

## Setup

Do the parts in this order. Allow about 30 minutes.

### Part 1 - The Sheet

1. Upload `FitTacker-data.xlsx` to Google Drive.
2. Open it, then choose **File > Save as Google Sheets**. Rename the new Sheet `Fit-Tracker`. You can delete the uploaded .xlsx.
3. Check **File > Settings > Time zone** is set to Manila.

### Part 2 - The script

1. In the Sheet: **Extensions > Apps Script**.
2. Delete whatever is in the editor, paste in all of `apps-script/Code.gs`, and press save.
3. Go back to the Sheet and reload the page. A **Fit Tracker** menu appears after a few seconds.
4. **Fit Tracker > 1. Run setup.** Google asks for permission the first time. Choose your account; on the "Google hasn't verified this app" screen choose **Advanced > Go to (project name)**, then **Allow**. Then run the menu item once more.
5. **Fit Tracker > 2. Set app PIN.** At least 6 characters. This is what protects your data.
6. **Fit Tracker > 3. Set Gemini API key.** Paste your key from Google AI Studio.
7. **Fit Tracker > 4. Turn on scheduled reports.**

### Part 3 - Publish the script

1. In the Apps Script editor: **Deploy > New deployment**.
2. Click the gear icon and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. Press **Deploy**.
4. In the Sheet: **Fit Tracker > Show connection details**. Keep this window open; you need both URLs below.

"Anyone" means anyone who has the long URL can reach the script, but it refuses every request without your PIN. Eight wrong PINs lock sign-in for 15 minutes.

### Part 4 - GitHub

1. Create a public repo named `Fit-Tracker`.
2. **Add file > Upload files**, and drag in everything from this folder, including the `icons` and `apps-script` folders. Commit.
3. **Settings > Pages > Build and deployment:** Source **Deploy from a branch**, Branch **main**, folder **/ (root)**. Save.
4. After a minute or two the app is at `https://YOUR-USERNAME.github.io/Fit-Tracker/`.

### Part 5 - Your phone

1. Open that address in Chrome.
2. Paste the **App URL** from Part 3 and type your PIN. Press **Connect**.
3. Chrome menu **(three dots) > Add to Home screen > Install**.

### Part 6 - Watch sync (sleep, golf, steps)

Your Amazfit already writes to Health Connect through Zepp. A small free Android app, **HC Webhook** (Health Connect to Webhook), forwards that to your Sheet.

1. Install HC Webhook from Google Play.
2. Give it Health Connect permission for: Sleep, Exercise, Steps, Active calories burned, Resting heart rate, Oxygen saturation.
3. Add a webhook and paste the **Watch webhook URL** from Part 3 (the one ending in `?hook=...`).
4. Choose scheduled sync at 08:00 and 21:00.
5. Press its manual sync button once, then look at the **Inbox** tab of the Sheet. A new row means the delivery arrived; the **Sleep** and **Activities** tabs should then fill in.

This part is built from the HC Webhook documentation and has not yet been run against your watch. If the Inbox tab shows deliveries but Sleep stays empty, the Inbox row holds exactly what the watch sent, which is what is needed to adjust the script.

If the watch misses a night, add it by hand in the app (Today > Add by hand).

## Daily use

- **Morning:** weight, last night's snore score, and once a week your waist.
- **Each meal:** tap the round button, then take a photo. Add a note such as "ate half" if it helps. Check the numbers and save. Nutrition labels scan most accurately.
- **Activity:** arrives from the watch. Manual entries are allowed, are labelled "manual", and never change the calorie budget.
- **Reports:** weekly on Monday morning and quarterly on the 1st of January, April, July and October, by email and in the Reports tab.

## Changing things later

**App files (`index.html`, `styles.css`, `app.js`):** upload the new file to GitHub over the old one. The phone picks it up the next time the app opens with a connection; close and reopen it once.

**`Code.gs`:** paste the new version into the Apps Script editor, save, then **Deploy > Manage deployments > pencil icon > Version: New version > Deploy**. Without that last step the phone keeps talking to the old code. The App URL stays the same.

**Targets:** in the app under Settings. Each change is kept as a new row in the Goals tab, so old days are still judged against the target of the time.

**Gemini model:** the `gemini_model` row in the Config tab.

**Report email address:** the `report_email` row in the Config tab. Blank means the Google account that owns the Sheet.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Wrong PIN" | Set it again: Sheet menu > Set app PIN |
| "Unexpected reply. Check the app URL..." | The deployment's access is not "Anyone", or the URL is not the one ending in `/exec` |
| A change to `Code.gs` has no effect | Deploy a new version (see above) |
| "Gemini error 404" | The model name in Config > `gemini_model` is not available to your key |
| "Gemini error 429" | The key's rate limit was reached; wait a minute |
| No Fit Tracker menu in the Sheet | Reload the Sheet; the menu takes a few seconds |
| No weekly email | Run Sheet menu > Turn on scheduled reports again, and check spam |

## What the numbers mean

- **Calories left** uses a fixed daily target. Burned calories are recorded and reported but not added back.
- **Calorie check** in reports compares what you logged with what the scale did over 8 weeks, and works out the maintenance level those two imply. Shorter windows are too noisy to trust, because morning weight moves by more than half a kilo from day to day.
- **Food quality** compares saturated fat, trans fat, added sugar, sodium and fibre with the WHO healthy diet guidance. Values from photos are estimates; trans fat especially.
- **Foods and your weight** (quarterly) needs a food tag to appear on at least 8 days. A change the next morning is mostly water and food volume; the 3-day figure is the better guide.
- Reports describe patterns in your own data. They are not medical advice.
