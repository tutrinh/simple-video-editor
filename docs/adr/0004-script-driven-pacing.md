# Script-driven pacing — a Beat's duration derives from its Script segment

Each Beat pairs a trimmed Clip with a Script segment shown as a Caption. Its
duration is set by the **Script segment's natural spoken length** (with a
readability floor), and the trim then selects the strongest window *of that
length* from the Clip. Words are the master clock; footage quality is the
trim-window decision within the duration the words dictate.

Chosen over footage-driven pacing (pick the best visual window, then size the
caption to fit) because the narrative is the actual product, and because it
makes the exported Script line up with the cut — when the user takes it to an
external voiceover tool (see ADR-0003), the narration is already timed to the
edit. The cost: a great 2-second moment may be stretched, or a duller stretch
shown, to fit the words.

**Consequence:** a Beat carries an explicit duration derived from its Script
segment, plus in/out trim points — not just a whole-clip reference.
