---
name: webjs-instagram-post
description: >
  Publish an SEO post to the WebJs Instagram account (@webjs_dev). Use this
  skill whenever the user asks to post to Instagram, publish an Instagram
  post, share something on Instagram, or promote a page/feature/blog on
  Instagram for SEO. Every post is strictly for SEO reach, so every post
  MUST ship a freshly created branded image plus a keyword-rich caption.
  The skill holds the account id, the credential location, the image recipe,
  the public-hosting requirement, and the two-step publish flow. It never
  prints or commits the access token.
allowed-tools: Bash(curl:*), Bash(magick:*), Bash(convert:*), Bash(identify:*), Bash(cp:*), Bash(mkdir:*), Bash(ls:*), Bash(git:*), Read, Write
---

# Post to Instagram for SEO

Every Instagram post on the WebJs account exists for SEO reach, not for
personal updates. So each post carries two things you build here: a freshly
created branded image, and a keyword-rich caption that names the capability
and links back to a webjs.dev page. Never publish a plain-text post and never
reuse a stale image.

## Account and API

- **Account** is the `@webjs_dev` professional (BUSINESS) account.
- **Numeric user id** is `17841441038146182`. On `graph.instagram.com` you can
  also address it as `me`.
- **API flavor** is the Instagram API with Instagram Login, so every call goes
  to `https://graph.instagram.com/v25.0/...` with a long-lived USER access
  token. An app token (the `appid|secret` shape) can never post.

## Credentials (never printed, never committed)

The token lives in a gitignored file OUTSIDE the repo:

```
~/.config/webjs/instagram.env
```

with `IG_TOKEN`, `IG_USER_ID`, and `IG_APP_SECRET`. Source it inside a script
and reference `${IG_TOKEN}`. NEVER `cat`, `echo`, or otherwise print the file,
and NEVER copy the token into the repo, a commit, or a chat message. If the
file is missing, ask the user to generate a long-lived user token from the
Meta dashboard and place it there.

```sh
set -a; . ~/.config/webjs/instagram.env; set +a
```

## Step 1: create the branded SEO image (required, JPEG)

The Instagram publishing API accepts a **JPEG only**, pulled from a public URL.
`build-post.sh` renders at 2x supersample and outputs a sharpened **1440x1440**
JPEG (quality 95) by default. This matters: a flat 1080 render looks soft in
Instagram's DESKTOP full-size view on a high-DPI screen after IG re-compresses
it, and the supersampled 1440 stays crisp. Do not drop back to a 1x 1080 render.

Match the webjs.dev OG theme, which is a NEAR-BLACK card with a soft warm glow
in the top-right corner, the orange squircle mark plus the white `webjs`
wordmark, a bold white headline with ONE orange-highlighted phrase, gray
subtext, and a small-caps footer meta row with a `webjs.dev` URL. It is a dark
card with orange accents, NOT an orange background.

`assets/build-post.sh` produces exactly this, parameterised by env var. Wrap the
key headline phrase in an orange span, and bold a few subtext words in white:

```sh
OUT=/tmp/post.jpg \
HEADLINE='The web framework for <span foreground="#F0803A">AI agents</span>' \
SUBTEXT='No build step. Built on <span foreground="#DcDcDc" font_weight="bold">web components</span>, SSR, and progressive enhancement. <span foreground="#DcDcDc" font_weight="bold">Standards that outlast frameworks.</span>' \
KICKER='BUILT FOR THE AI ERA' \
META='NO BUILD   ·   WEB COMPONENTS   ·   SSR' \
  bash "$(dirname "$0")/assets/build-post.sh"
```

It needs ImageMagick with Pango. Always read `$OUT` back and eyeball it before
publishing: check the headline does not collide with the subtext (the script
stacks them dynamically, but a very long headline can still crowd), and that
the footer meta does not overrun the `webjs.dev` URL.

### Verify the thumbnail crop (do NOT skip this)

The Instagram **profile grid** crops a 1:1 post to a **3:4 portrait**, keeping
full height but trimming roughly 135px off EACH side of a 1080-wide image. So
text that looks fine on the square card gets clipped, or sticks to the edge, in
the grid thumbnail. `build-post.sh` already keeps every element inside a 200px
safe margin for this reason, but ALWAYS confirm by simulating the crop and
eyeballing it:

```sh
# 3:4 crop of the default 1440 output (keep full height, center 75% width)
magick "$OUT" -gravity center -crop 1080x1440+0+0 +repage /tmp/grid-crop.jpg
# open /tmp/grid-crop.jpg: no text may touch an edge, padding on both sides
```

If anything is tight, widen `PAD` in `build-post.sh` and shrink the headline /
subtext `-size` widths, then rebuild and re-check. This took several iterations
in practice, so treat the crop check as mandatory, not optional.

## Step 2: host the image at a public HTTPS URL

Meta fetches the image server-side, so it MUST sit at a public HTTPS URL before
you publish. The default, lowest-overhead route is a **throwaway branch in a
worktree whose raw GitHub URL Instagram fetches** (the `webjsdev/webjs` repo is
PUBLIC). Do NOT open a PR, do NOT merge, and do NOT commit these cards to main:
the card is not linked from anywhere on webjs.dev, so committing it carries no
SEO value, and the user has explicitly rejected the PR/deploy overhead. IG
fetches and stores its OWN copy at create-container time (Step 4), so the branch
only has to exist for that one call, then it is deleted.

```sh
SLUG=works-without-javascript                 # match the post topic
BR=chore/ig-social-$SLUG
git -C "$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')" worktree add -b "$BR" ../webjs-ig-social origin/main  # rooted at the PRIMARY checkout, so it never nests under a task worktree
mkdir -p ../webjs-ig-social/website/public/social
cp "$OUT" ../webjs-ig-social/website/public/social/$SLUG.jpg
( cd "$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')/../webjs-ig-social"
  git add website/public/social/$SLUG.jpg
  git commit -q -m "chore: add $SLUG Instagram social card asset"
  git push -q -u origin "$BR" )

# the raw URL Instagram fetches (public repo, serves content-type: image/jpeg)
IMG="https://raw.githubusercontent.com/webjsdev/webjs/$BR/website/public/social/$SLUG.jpg"
```

After the post is published in Step 4, tear the branch down so nothing lingers:

```sh
git worktree remove ../webjs-ig-social --force
git branch -D "$BR"
git push origin --delete "$BR"
```

Any other public HTTPS host works too, as long as the final URL is reachable
and serves real JPEG bytes. (Committing to `website/public/social/` + a PR +
Railway deploy also works and lands a real `webjs.dev/public/social/<slug>.jpg`
asset, but that is heavier and not the default. Only take it if the user
specifically wants the asset on the site.)

ALWAYS verify the hosted URL round-trips real bytes BEFORE publishing:

```sh
curl -s "$IMG" -o /tmp/verify.jpg && identify /tmp/verify.jpg
```

A host can return a URL yet store an EMPTY file (catbox did this in testing),
and Instagram then fails the create-container call with a useless generic
`{"error":{"code":1,"message":"An unknown error has occurred."}}`. If you see
code 1, suspect the image URL first: confirm it downloads a valid JPEG of the
right dimensions, and re-host on a different provider if not.

## Step 3: write the SEO caption

- First line names the capability with the primary keyword, since the first
  line is what search and the feed show.
- Add a short body that expands the value in plain words.
- Close with a bare `webjs.dev/<path>` reference (Instagram captions are not
  clickable, but the text is still indexable and it drives to the bio link).
- Append a focused hashtag set. Reuse a core set and add a few per-topic ones,
  for example `#webdevelopment #javascript #webcomponents #framework #ssr
  #frontend #buildless #aicoding`.

Keep it honest about what WebJs does. Do not oversell, and do not frame a
WebJs feature as another tool's branded feature.

## Step 4: publish (confirm first, it is public)

Publishing is public and hard to undo, so ALWAYS confirm the exact image and
caption with the user before this step. Check the quota first (limit is 25 per
rolling 24 hours).

```sh
set -a; . ~/.config/webjs/instagram.env; set +a
IMG="https://webjs.dev/public/social/why-webjs.jpg"
CAP="Build on the platform, not against it. WebJs is a no-build, web-components-first framework. webjs.dev/why #webdevelopment #javascript #webcomponents"

# quota
curl -s "https://graph.instagram.com/v25.0/me/content_publishing_limit?access_token=${IG_TOKEN}"

# 1) create the media container
CREATE=$(curl -s "https://graph.instagram.com/v25.0/me/media" \
  --data-urlencode "image_url=${IMG}" \
  --data-urlencode "caption=${CAP}" \
  --data-urlencode "access_token=${IG_TOKEN}")
echo "$CREATE"
CREATION_ID=$(printf '%s' "$CREATE" | grep -oE '"id":"[0-9]+"' | head -1 | grep -oE '[0-9]+')

# 2) WAIT until the container is FINISHED. Publishing too fast fails with
#    code 9007 "Media ID is not available" even for a static image.
for i in $(seq 1 25); do
  ST=$(curl -s "https://graph.instagram.com/v25.0/${CREATION_ID}?fields=status_code&access_token=${IG_TOKEN}")
  printf '%s' "$ST" | grep -q '"status_code":"FINISHED"' && break
  printf '%s' "$ST" | grep -q '"status_code":"ERROR"' && { echo "container ERROR: $ST"; break; }
done

# 3) publish the container
curl -s "https://graph.instagram.com/v25.0/me/media_publish" \
  --data-urlencode "creation_id=${CREATION_ID}" \
  --data-urlencode "access_token=${IG_TOKEN}"
echo
```

Only the API JSON is ever printed, so the token stays out of the transcript.
A successful publish returns the new media id. Report that id to the user.

## Token refresh (keeps the account posting)

A long-lived token lasts 60 days and is refreshable any time after it is 24
hours old. Refresh on a schedule so it never lapses:

```sh
set -a; . ~/.config/webjs/instagram.env; set +a
curl -s "https://graph.instagram.com/v25.0/refresh_access_token?grant_type=ig_refresh_token&access_token=${IG_TOKEN}"
```

Then write the returned token back into `~/.config/webjs/instagram.env` without
printing it.

## The profile avatar

The `@webjs_dev` profile picture is already set in the Instagram app (the
publishing API cannot change a profile picture, so it is a manual step). The
avatar is NOT committed to the repo. If you ever need to regenerate one, build
it locally and set it by hand, never commit the PNG:

```sh
magick -size 1080x1080 -define gradient:angle=135 gradient:'#FF8C3A'-'#DE5F10' base.png
magick -background none -fill white -font Adwaita-Sans-ExtraBold -kerning -8 \
  -size 800x -gravity center label:'webjs' wordmark.png
magick base.png wordmark.png -gravity center -composite /tmp/webjs-instagram-avatar.png
```
