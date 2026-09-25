import source from '@/assets/mark.svg?raw';

/**
 * The mark, drawn inline so it takes `currentColor` from wherever it sits: the title bar colours
 * it one way, About another, and both themes follow the token layer without a second file.
 *
 * The drawing is this product's own file, bundled at build time — never anything a person
 * opened. Its comments are stripped so they do not travel into the page.
 */
const MARK = source.replace(/<!--[\s\S]*?-->/g, '').trim();

export function Mark({ size, className = '' }: { size: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center [&>svg]:size-full ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: MARK }}
    />
  );
}
