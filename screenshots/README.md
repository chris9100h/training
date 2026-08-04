# Screenshots for the public pages

`welcome.html` renders each screenshot slot as an `<img>` on top of a
placeholder. If the file is missing, the image removes itself via `onerror`
and the placeholder shows through, so the page never looks broken while a
shot is still outstanding. **Dropping a file in here is the whole job**, no
markup change needed.

## Status

| File | Where it appears | Status |
| --- | --- | --- |
| `home.jpg` | Hero, next to the headline | Delivered |
| `food.jpg` | Health & nutrition section | Delivered |
| `coaching.jpg` | Coaching section | Delivered |
| `train.jpg` | Gallery, "Logging a set" | Delivered |
| `plan.jpg` | Gallery, "Your week" | Delivered |
| `progress.jpg` | Gallery, "Progress and PRs" | **Missing.** A progress chart or the records screen |
| `health.jpg` | Gallery, "Daily log" | **Missing.** The daily health log with weight, steps, water |

The two missing ones are optional. Their slots show a placeholder until the
files land.

## Format

The delivered shots are 1320x2580 (an iPhone screenshot), and the frames in
`welcome.html` follow that aspect through `--shot-ratio`, so a phone shot fits
edge to edge without losing its sides. Two consequences worth knowing:

- **A shot from a differently proportioned device gets cropped.** Images are
  `object-fit: cover` anchored to the **top**, so a taller image loses its
  bottom edge rather than its header. `food.jpg` is a share card at 1:2.45 and
  is cropped that way on purpose.
- **If every future shot comes from a different device**, change
  `--shot-ratio` in `welcome.html` rather than padding the images.

Files are resized to **800px wide** and saved as JPEG at quality 86. The
frames are at most 290 CSS px, so 800px covers a 3x display with room to
spare, and the whole set stays around 700 KB. Source screenshots do not need
resizing before handing them over.

## How to capture

- Take them on a real phone with the app installed to the home screen, so
  there is no browser chrome in the shot.
- Use the **dark theme** with the **gold accent**, which is what the page is
  built around.
- Full device resolution is fine. Resizing happens on the way in.

## Before you commit

Check the shots for anything you do not want on a public page: real names in
a coaching thread, an email address in a header, body weight or health
figures you would rather not publish. The app has a demo-friendly amount of
placeholder data, so it is usually easier to stage a shot than to blur one.
