# Screenshots for the public pages

`welcome.html` renders each screenshot slot as an `<img>` sitting on top of a
placeholder. If the file is missing, the image removes itself and the
placeholder shows through, so the page never looks broken while a shot is
still outstanding. **Dropping a file in here is the whole job**, no markup
change needed.

## Expected files

| File | Where it appears | What to capture |
| --- | --- | --- |
| `home.png` | Hero, next to the headline | The Home dashboard, ideally with a plan running and something already logged |
| `food.png` | Health & nutrition section | The food tracker with a day's meals logged, macros visible |
| `coaching.png` | Coaching section | A coaching thread or the check-in view |
| `train.png` | Gallery, "Logging a set" | The live workout screen with the lifting keypad open |
| `plan.png` | Gallery, "Your week" | The training plan / week view |
| `progress.png` | Gallery, "Progress and PRs" | A progress chart or the records screen |
| `health.png` | Gallery, "Daily log" | The daily health log with weight, steps, water |

All seven are optional and independent. Ship two, ship all of them, the page
holds either way.

## How to capture

The frames are `9 / 19.5` (a modern phone) and the image is cropped with
`object-fit: cover` anchored to the **top**, so anything important should sit
in the upper two thirds. A tall screenshot loses its bottom edge, not its
header.

- Take them on a real phone with the app installed to the home screen, so
  there is no browser chrome in the shot.
- Use the **dark theme** with the **gold accent**, which is what the page is
  built around. A light-theme shot will look correct but will not sit as well
  next to the surrounding panels.
- PNG, at native device resolution. No need to downscale, but do run them
  through an optimizer if any single file lands above ~500 KB.

## Before you commit

Check the shots for anything you do not want on a public page: real names in
a coaching thread, an email address in a header, body weight or health
figures you would rather not publish. The app has a demo-friendly amount of
placeholder data, so it is usually easier to stage a shot than to blur one.
