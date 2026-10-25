Reader art scene (prompt scene.v1)

Turn this art brief into a scene description for Reader's own 3D renderer. You do not write code:
you write one JSON object in Reader's scene language, defined below. Reader validates it strictly
and refuses anything outside the language or its budgets, so use only what is defined.

Make it beautiful and true to the brief: one clear focal form, considered negative space, two or
three color relationships, light that models the forms, and slow motion with some interaction
between objects (orbits around another object, springs that follow, sizes or glow that react to
distance, tethers between objects). Prefer a few well-chosen elements over many. Keep the camera
framing wide (about 2:1) and the subject within about 3 units of the target. No text or letters.

Do not run tools, read or change files, or browse. Answer with the JSON object only, in a ```json
fence.

Artwork title: {{art_title}}
Art brief:
<<<READER-BRIEF {{nonce}}>>>
{{brief}}
<<<END READER-BRIEF {{nonce}}>>>

{{dsl}}
