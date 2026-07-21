# A Clip Description describes the footage; it does not coach the creator

A Clip Description is a **neutral, observational** read of what a single Clip
contains — subject/action, setting/mood, and a usability rating. It is *not*
second-person coaching about what the creator should do or say to camera.

This corrects a drift: the `describeClip` prompt had become a "vlog coach"
("Don't describe the scene — coach the creator… the single thing he/she should
do or say to camera"), and the type carried `vlogMove` / `energy` fields.

We reverse it for two reasons:

1. **Coaching is un-actionable here.** The tool edits clips that are *already
   shot*. Telling the creator what they "should say to camera" cannot be acted
   on after the fact — the footage exists as-is.
2. **A description is the better Story signal.** The Author step sequences a
   Story from these reads. "Hiker pushing up scree, effortful, overcast light"
   is something to build a narrative from; "you should say X to camera" is not.

This keeps the product the neutral **curator** the glossary describes (discovers
a Story across arbitrary footage), not a vlog-delivery critic.

**Consequence:** the code must be realigned to the model — rewrite `describeClip`
to describe (subject/action, setting/mood, usability) and rename the
`vlogMove` / `energy` fields accordingly. Until that lands, the code and the
glossary disagree; the glossary is canonical.
