# Recipe photography — prompts

Photorealistic dish images, generated **on demand from the admin console** and reviewed by
a person before they go live. The pipeline is specified in
[`image-pipeline.html`](image-pipeline.html).

The prompt below is not usually pasted by a human — it is what `composeImagePrompt(meal)`
builds from each meal's own fields when an operator clicks **Generate**. It is documented
here so the wording is reviewable as copy rather than buried in a service, and so an
operator can read what was sent when a result comes back wrong.

The console also lets an operator **edit the prompt before regenerating**, which is the
fast path when a dish comes back as the wrong food — see §07 of the pipeline doc.

> **Do not mix illustration and photography on one surface.** An
> [illustration](illustrations/) beside a photograph of the same dish reads as two
> products. The flow uses drawn art *until* photography exists for a meal, then swaps
> wholesale — never both at once.

## The composed prompt

`IMAGE_PROMPT_VERSION = 1`. Bump it whenever this wording changes, so a reprompt sweep can
find every image made by an older version.

```
A photograph of {meal.name}, a Nigerian dish.

Made with {up to 5 non-optional ingredient names, comma-separated}.

SHOT
A single serving, photographed from directly overhead or at 45 degrees. Natural daylight
from one side, soft shadows. Shallow depth of field. Resting on a plain wooden table or a
simple laminate surface. Square crop, the food filling most of the frame.

SERVED AS IT REALLY IS
Served in a real Nigerian home: an ordinary ceramic plate or an enamel bowl. No garnish
that would not actually be there. No styling, no restaurant plating, no microgreens, no
sauce drizzle, no edible flowers, no artful smears. A generous, ordinary portion — the
amount a person would actually eat, not a tasting portion.
{per-dish hint, when one exists for this meal}

MUST NOT APPEAR
No text, no lettering, no watermark, no logo. No hands, no people, no faces. No cutlery
being held. No branded packaging or product labels. No menu card. No restaurant interior.
No artificial steam sprayed for effect. No stock-photo composition.
```

## The per-dish hint map

The highest-leverage part of the file, and the part that improves through use. Each entry
is written the first time an operator rejects an image for that specific confusion.

| Meal | Hint appended |
|---|---|
| Jollof rice | `Orange-red rice, coloured by tomato and pepper — NOT yellow, NOT saffron, NOT paella, NOT biryani.` |
| Egusi soup | `A coarse, pale-green melon-seed stew with a lumpy curdled texture — NOT guacamole, NOT pesto, NOT a smooth purée.` |
| Amala | `A smooth, very dark brown swallow, matte, shaped into a soft mound — NOT chocolate, NOT mousse, NOT a dessert.` |
| Ewedu | `A thin, bright green, slightly viscous soup — NOT a smoothie, NOT a matcha drink.` |
| Ogbono soup | `A dark, noticeably slimy drawn soup that strings when lifted — this texture is correct and must be visible.` |
| Fufu / eba | `A plain white or pale cream ball of swallow, smooth and matte — NOT a dumpling, NOT bread, NOT rice.` |
| Moi moi | `A dense steamed bean pudding, orange-brown, firm enough to hold a wedge shape — NOT cake, NOT frittata.` |
| Akara | `Round, deep-fried bean fritters, golden brown and irregular — NOT doughnuts, NOT falafel balls.` |
| Suya | `Thin skewered beef crusted in a dry rust-red peanut-and-pepper spice mix — NOT saucy, NOT glazed, NOT satay.` |
| Pepper soup | `A thin, clear-to-reddish broth with visible pieces of meat or fish — NOT a thick creamy bisque.` |
| Efo riro | `A dark green leafy stew with visible palm oil and chunks of meat and fish — NOT creamed spinach.` |
| Dodo | `Thick slices of ripe plantain, fried to deep gold with dark caramelised edges — NOT banana, NOT chips.` |

## Verification pass

Each generated image is checked by a vision call before storage — prompt id
`image.verify`, schema `MealImageVerdictSchema`. It is the machine half of the quality gate
in `image-pipeline.html` §06.

```
You are checking whether a generated photograph shows the dish it was
supposed to show. You are a gatekeeper, not a critic — judge the subject,
not the artistry.

THE DISH: {meal.name}
MADE WITH: {key ingredients}

Answer four things:

isDish          Does this photograph show the named Nigerian dish?
                Be strict. Jollof rice that looks like paella is NOT jollof.
                Egusi that looks like guacamole is NOT egusi. If it is a
                different dish that merely resembles it, answer false.

looksHomemade   Is this served as home food — an ordinary plate or bowl,
                an ordinary portion? Restaurant plating, tasting portions,
                garnish towers and sauce drizzle all mean false.

hasForbidden    Is there any text, lettering, watermark, logo, hand, face,
                held cutlery, branded packaging or restaurant interior?

confidence      0.0-1.0, how sure you are of the isDish answer.

reason          One sentence a person can act on: "this is paella, not
                jollof — the rice is yellow", or "correct dish, plated
                like a restaurant".
```

Ends with the standard `METRICS_CONTRACT` block, like every other prompt in the system.

## Why a human still reviews

The vision pass catches the confident failures cheaply, which is what makes the human pass
short — not what removes it. Image models get Nigerian food wrong in *plausible* ways, and
a wrong photograph is worse than no photograph, because it teaches the person the app does
not know the cuisine. Auto-publish is earned per confidence band once operator agreement is
measured, not assumed on day one.
