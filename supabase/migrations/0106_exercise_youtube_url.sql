-- Optional YouTube form-reference link per exercise. Shown as a play button in
-- the exercise editor (Library) and during training when set; opens the video.
ALTER TABLE zane_exercises ADD COLUMN IF NOT EXISTS youtube_url text;
