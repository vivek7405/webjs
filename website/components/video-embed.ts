import { WebComponent, html, prop } from '@webjsdev/core';

/**
 * `<video-embed>` renders a YouTube video as a poster the reader clicks,
 * swapping in the real player only on that click.
 *
 * Why a facade rather than a plain iframe. A cross-origin frame paints its
 * own canvas, and until the embedded document's stylesheet applies, that
 * canvas is the UA default. YouTube's embed sets the black background on
 * body and declares no color-scheme, so the black lands only at its first
 * paint. Before then the box is white on the engines that composite an
 * opaque canvas, which is a bright rectangle in the middle of a dark page
 * on a phone. Painting a background on the iframe ELEMENT does not fix it,
 * because the element background sits behind that canvas rather than over
 * it, and it was tried first here. Nothing the embedding page can declare
 * reaches inside a cross-origin frame, so the only reliable answer is to
 * not have a frame on screen until the reader asks for one.
 *
 * What the reader gets instead is an `<img>` poster, which is an ordinary
 * replaced element with no canvas of its own: before it decodes, the box
 * shows OUR background, so it tracks the site theme in every engine. The
 * player then arrives on click already playing, so the black it paints is
 * the video starting rather than a flash.
 *
 * The poster is also a good deal cheaper than the thing it defers: the
 * embed pulls a substantial amount of third-party script on load, and this
 * page paid that on every visit for a video most readers never started.
 *
 * Progressive enhancement. The click-to-load path is JS, so SSR also emits
 * a `<noscript>` carrying the plain iframe. With JS off the reader gets the
 * player directly, which is exactly the markup this component replaced. The
 * white-flash tradeoff rides along with it, and that is the right call: a
 * reader with no JS should get a working video, not a themed placeholder
 * with a dead button.
 *
 * Usage:
 *   <video-embed videoid="XghCghezod4" label="WebJs introduction video">
 *   </video-embed>
 */
export class VideoEmbed extends WebComponent({
  /**
   * The YouTube id. Kebab-cased attributes are what the SSR reader matches,
   * and a single lowercase word needs no hyphen, so `videoid` is both the
   * property and the attribute.
   */
  videoid: prop(String),

  /**
   * The iframe's accessible name, and the poster button's. Both need one,
   * and the video has a single title, so they share the prop.
   */
  label: prop(String),

  /**
   * Flipped by the click that swaps the poster for the player. Internal
   * state rather than a reactive attribute: nothing outside the component
   * sets it, and a `state: true` prop is skipped by the SSR attribute
   * reader, so it can never arrive pre-flipped from markup.
   */
  playing: prop(Boolean, { state: true }),
}) {
  constructor() {
    super();
    this.videoid = '';
    this.label = '';
    this.playing = false;
  }

  /**
   * `autoplay=1` only on the click-loaded player. The reader has already
   * expressed intent by then, so it starts without a second tap. The
   * noscript iframe deliberately omits it.
   */
  private playerSrc() {
    return `https://www.youtube-nocookie.com/embed/${this.videoid}?rel=0&autoplay=1`;
  }

  private posterSrc() {
    return `https://i.ytimg.com/vi/${this.videoid}/maxresdefault.jpg`;
  }

  /** Plain iframe for the JS-off path, without autoplay. */
  private noscriptSrc() {
    return `https://www.youtube-nocookie.com/embed/${this.videoid}?rel=0`;
  }

  render() {
    // Built out here, never inside the html template: a backtick anywhere in
    // a template body closes the literal at JS-parse time (invariant 9).
    const playLabel = 'Play ' + this.label;
    const noscriptSrc = this.noscriptSrc();

    if (this.playing) {
      return html`
        <iframe
          class="w-full h-full"
          src=${this.playerSrc()}
          title=${this.label}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        ></iframe>
      `;
    }

    return html`
      <button
        type="button"
        class="group relative block w-full h-full cursor-pointer border-0 p-0 bg-bg-sunken"
        aria-label=${playLabel}
        @click=${() => { this.playing = true; }}
      >
        <img
          class="w-full h-full object-cover"
          src=${this.posterSrc()}
          alt=""
          loading="lazy"
          decoding="async"
        >
        <span
          class="absolute inset-0 grid place-items-center bg-[oklch(0_0_0/0.15)] transition-colors group-hover:bg-[oklch(0_0_0/0.05)]"
        >
          <span
            class="grid place-items-center w-[68px] h-[48px] rounded-[14px] bg-[oklch(0.55_0.24_25)] shadow-[var(--shadow)] transition-transform group-hover:scale-110"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z"/>
            </svg>
          </span>
        </span>
      </button>
      <noscript>
        <!-- With JS off the component never hydrates, so the poster button
             above is server-rendered and inert. Hide it and show the real
             player instead. The selector carries the tag name because a
             light-DOM component's CSS must (invariant 7). -->
        <style>video-embed button { display: none }</style>
        <iframe
          class="w-full h-full"
          src=${noscriptSrc}
          title=${this.label}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        ></iframe>
      </noscript>
    `;
  }
}

VideoEmbed.register('video-embed');
