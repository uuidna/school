import { describe } from './i18n/admin.js'

import type { Field } from 'payload'

/**
 * Slugs, in one place.
 *
 * Payload's own `slugField` formats with `replace(/[^\w-]+/g, '')`, and `\w` is
 * ASCII: „Учебни планове“ becomes `--------`, so every Bulgarian page collides
 * on the unique index. This module replaces it, and settles the one real
 * question — whether a slug keeps its own script or is romanised.
 *
 * **Paths are international by default.** A URL is an address, and an address
 * that only a reader of one script can type, quote in an order, or paste into
 * a form is a narrower thing than it looks. So:
 *
 * - **romanise** (default): `strategiya-za-razvitie`, following the official
 *   Bulgarian transliteration (Закон за транслитерацията). Every new URL the
 *   package mints — the document tree, tenant hosts — is latin.
 * - **keep**: `/учебни-планове`, asked for explicitly. It exists for the one
 *   case that justifies a localised address: a school whose pages have had
 *   these URLs for years, where changing them breaks every existing link. That
 *   is a dedicated localised method, chosen per collection, not a default
 *   anybody gets by omission.
 */

const BG_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht',
  ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
}

export const transliterate = (text: string): string =>
  [...text.toLowerCase()].map((char) => BG_TO_LATIN[char] ?? char).join('')

export type SlugStyle = 'keep' | 'romanise'

export const slugify = (text: string, style: SlugStyle = 'romanise', maxLength = 200): string => {
  const base = style === 'romanise' ? transliterate(text) : text.toLowerCase()

  return base
    .trim()
    // `romanise` has already reduced letters to ASCII; `keep` preserves any
    // Unicode letter or number and treats everything else as a separator.
    .replace(style === 'romanise' ? /[^a-z0-9]+/g : /[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '')
}

export const slugField = ({
  from = 'title',
  style = 'romanise',
}: { from?: string; style?: SlugStyle } = {}): Field => ({
  name: 'slug',
  type: 'text',
  admin: {
    description: describe('slug'),
    position: 'sidebar',
  },
  hooks: {
    beforeValidate: [
      ({ data, operation, originalDoc, value }) => {
        const stored = (originalDoc as Record<string, unknown> | undefined)?.slug

        if (typeof value === 'string' && value.trim()) {
          // A slug that already exists is a live address. Re-deriving it on
          // every save means any bulk edit is a URL change with nothing said:
          // re-saving 74 pages to fix their headings silently rewrote six
          // Cyrillic slugs to the romanised default and 404'd six indexed
          // URLs. It is normalised when somebody edits it, and otherwise left
          // exactly as it is — including when it does not match the current
          // style, because an address predating a policy is still an address.
          if (operation === 'update' && value === stored) return value
          return slugify(value, style)
        }

        const source = data?.[from]
        return typeof source === 'string' && source.trim() ? slugify(source, style) : value
      },
    ],
  },
  index: true,
  label: 'Slug',
  unique: true,
})
