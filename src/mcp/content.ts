import type { PayloadRequest } from 'payload'

import { convertMarkdownToLexical, editorConfigFactory } from '@payloadcms/richtext-lexical'

import type { SchoolMcpTool } from './registry.js'

import { slugify } from '../slug.js'
import { ingestImages } from '../media/ingest.js'
import { findAll } from '../payload/findAll.js'
import { andWhere, tenantStamp, tenantWhere } from '../payload/scope.js'
import { enumOf, failure, json, str } from './registry.js'

/**
 * Content workflows.
 *
 * An agent sends **markdown** and the CMS converts it to Lexical here, using
 * this project's own editor config. The conversion stays in one place: a client
 * never builds editor nodes, and every caller — migration, agent, automation —
 * produces identical documents.
 */

/**
 * Headings are clamped into h2-h4.
 *
 * A page renders its own title, so a document that also opens with `# Title`
 * states it twice — and the content editor allows h2-h4 only. The source pages
 * additionally use `######` as a bold label, which is no heading level the
 * editor accepts. Everything is shifted down one and clamped, which keeps the
 * outline, leaves exactly one h1 per page (the title), and never emits a level
 * the field will reject.
 */
const clampHeadings = (markdown: string): string =>
  markdown
    .split('\n')
    .map((line) => {
      const match = line.match(/^(#{1,6})\s+(.*)$/)
      if (!match) return line
      const level = Math.min(Math.max(match[1]!.length + 1, 2), 4)
      return `${'#'.repeat(level)} ${match[2]}`
    })
    .join('\n')

/**
 * Images, resolved to the school's own media or left as a reachable link.
 *
 * `convertMarkdownToLexical` has no transformer that turns a remote image URL
 * into an upload node, because an upload node must reference a Media document.
 * Left alone it renders `![](https://…)` as literal text, which is how 361
 * images across 76 pages became visible markup instead of photographs.
 *
 * A markdown transformer could not have done this, which is the obvious
 * reviewer question. Lexical's own `UploadFeature` imports on
 * `/!\[([^\]:]+):([^\]]+)\]\(\)/` — `![relationTo:id]()`, the placeholder it
 * exports itself. It never matches a remote URL, so no configuration of
 * `convertMarkdownToLexical` turns `![](https://…)` into an upload node.
 * Ingesting first and mapping second is not a way round a gap; it is the only
 * shape that can work.
 *
 * Given a map of source URL to media id, an image becomes an upload node.
 * Without one it becomes a **link carrying its URL** — never literal markdown,
 * never silently dropped. A school whose ingest has not run yet should get
 * something clickable, not a page that quietly lost its photographs.
 *
 * Those fallback links are marked `noreferrer`. A page that embeds or links to
 * a third-party address tells that third party which page was being read, and
 * on this surface the page address can name a class. Once the image is in the
 * school's own library it is same-origin and the question does not arise —
 * which is a reason to ingest beyond how it looks.
 */
const resolveImages = (markdown: string, images?: Record<string, number | string>): string =>
  markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, alt: string, url: string) => {
    if (images?.[url] !== undefined) return whole
    // Not an image node, but reachable and plainly marked.
    return `[${alt || url}](${url})`
  })

const toLexical = async (
  req: PayloadRequest,
  markdown: string,
  images?: Record<string, number | string>,
) => {
  const editorConfig = await editorConfigFactory.default({ config: req.payload.config })
  return convertMarkdownToLexical({
    editorConfig,
    markdown: resolveImages(clampHeadings(markdown), images),
  })
}

export const contentMcpTools: SchoolMcpTool[] = [
  {
    name: 'school_ingest_images',
    allowedRoles: ['admin', 'teacher'],
    needs: ['content'],
    description:
      'Brings images into the school’s own media library and returns a source-URL-to-id map for school_publish_page. Send the bytes: this never retrieves a URL, so there is no address a caller can point the server at. Identical files are stored once however many addresses they had, and re-running is safe.',
    inputSchema: {
      properties: {
        images: {
          description: 'The files themselves, base64, each with the address it came from.',
          items: {
            properties: {
              bytes: str('The file, base64 encoded'),
              filename: str('Original filename, used to name the stored file'),
              mimeType: str('image/jpeg, image/png, image/webp, image/gif, image/avif or image/svg+xml'),
              sourceUrl: str('Where it was found — recorded as provenance, never retrieved'),
            },
            required: ['bytes', 'filename', 'mimeType', 'sourceUrl'],
            type: 'object',
          },
          type: 'array',
        },
      },
      required: ['images'],
      type: 'object',
    },
    writes: true,
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      const images = (args.images ?? []) as {
        bytes?: string
        filename?: string
        mimeType?: string
        sourceUrl?: string
      }[]

      if (!images.length) return failure('No images were sent.')

      const result = await ingestImages(
        req,
        images.map((image) => ({
          bytes: image.bytes ?? '',
          filename: image.filename ?? '',
          mimeType: image.mimeType ?? '',
          sourceUrl: image.sourceUrl ?? '',
        })),
      )

      return json({
        ...result,
        note: 'Files are keyed on a hash of their bytes, so the same image under several addresses is stored once. Nothing here was retrieved — only what you sent was stored.',
      })
    },
  },
  {
    name: 'school_publish_page',
    needs: ['content'],
    description:
      'Create or replace a page from markdown and publish it. The markdown is converted to Lexical by the CMS, so the caller never builds editor nodes. Matching on slug, so running it twice updates rather than duplicates.',
    allowedRoles: ['admin', 'teacher'],
    writes: true,
    inputSchema: {
      properties: {
        images: {
          description:
            'Source URL to media id, from school_ingest_images. Without it an image becomes a link carrying its URL rather than literal markdown.',
          type: 'object',
        },
        markdown: str('Page body as markdown — headings, lists, links, tables'),
        slug: str('URL candidate. Derived from the title (Bulgarian transliterated) when omitted'),
        status: enumOf(['draft', 'published'], 'Defaults to published'),
        title: str('Page title'),
      },
      required: ['title', 'markdown'],
      type: 'object',
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      const title = String(args.title)
      const slug = String(args.slug ?? slugify(title))
      const richText = await toLexical(req, String(args.markdown ?? ''), args.images as Record<string, number | string> | undefined)

      const existing = await req.payload.find({
        collection: 'pages',
        draft: true,
        limit: 1,
        overrideAccess: false,
        req,
        where: andWhere(await tenantWhere(req.payload, req, 'pages'), {
          slug: { equals: slug },
        }),
      })

      const data = {
        _status: args.status ?? 'published',
        hero: { type: 'lowImpact' },
        layout: [{ blockType: 'content', columns: [{ richText, size: 'full' }] }],
        slug,
        title,
        // Without this the page belongs to no school and no report finds it.
        ...(await tenantStamp(req.payload, req, 'pages')),
      }

      const page = existing.docs[0]
        ? await req.payload.update({
            collection: 'pages',
            // revalidatePath needs a Next request; an MCP call is not one.
            context: { disableRevalidate: true },
            data: data as never,
            draft: false,
            id: existing.docs[0].id,
            overrideAccess: false,
            req,
          })
        : await req.payload.create({
            collection: 'pages',
            context: { disableRevalidate: true },
            data: data as never,
            draft: false,
            overrideAccess: false,
            req,
          })

      return json({ action: existing.docs[0] ? 'updated' : 'created', id: page.id, slug, title, url: `/${slug}` })
    },
  },
  {
    name: 'school_publish_post',
    needs: ['content'],
    description:
      'Create or replace a news post from markdown and publish it. Same conversion as pages; matched on slug.',
    allowedRoles: ['admin', 'teacher'],
    writes: true,
    inputSchema: {
      properties: {
        images: {
          description: 'Source URL to media id, from school_ingest_images.',
          type: 'object',
        },
        markdown: str('Post body as markdown'),
        publishedAt: str('ISO date; defaults to now'),
        slug: str('URL candidate; derived from the title when omitted'),
        title: str('Post title'),
      },
      required: ['title', 'markdown'],
      type: 'object',
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      const title = String(args.title)
      const slug = String(args.slug ?? slugify(title))
      const content = await toLexical(req, String(args.markdown ?? ''), args.images as Record<string, number | string> | undefined)

      const existing = await req.payload.find({
        collection: 'posts',
        draft: true,
        limit: 1,
        overrideAccess: false,
        req,
        where: andWhere(await tenantWhere(req.payload, req, 'posts'), {
          slug: { equals: slug },
        }),
      })

      const data = {
        _status: 'published',
        content,
        publishedAt: args.publishedAt ?? new Date().toISOString(),
        slug,
        title,
        ...(await tenantStamp(req.payload, req, 'posts')),
      }

      const post = existing.docs[0]
        ? await req.payload.update({
            collection: 'posts',
            context: { disableRevalidate: true },
            data: data as never,
            draft: false,
            id: existing.docs[0].id,
            overrideAccess: false,
            req,
          })
        : await req.payload.create({
            collection: 'posts',
            context: { disableRevalidate: true },
            data: data as never,
            draft: false,
            overrideAccess: false,
            req,
          })

      return json({ action: existing.docs[0] ? 'updated' : 'created', id: post.id, slug, title, url: `/posts/${slug}` })
    },
  },
  {
    name: 'school_list_content',
    needs: ['content'],
    description:
      'Every page and post with its slug, title and publication status — the inventory to check what exists before writing.',
    allowedRoles: ['admin', 'registrar', 'teacher'],
    writes: false,
    inputSchema: { type: 'object' },
    handler: async (_args: Record<string, unknown>, req: PayloadRequest) => {
      const [pages, posts] = await Promise.all([
        findAll<Record<string, unknown>>(req.payload, { collection: 'pages', req, sort: 'slug' }),
        findAll<Record<string, unknown>>(req.payload, { collection: 'posts', req, sort: 'slug' }),
      ])

      const shape = (docs: Record<string, unknown>[]) =>
        docs.map((doc) => ({ slug: doc.slug, status: doc._status, title: doc.title }))

      return json({
        pages: shape(pages),
        pageCount: pages.length,
        postCount: posts.length,
        posts: shape(posts),
      })
    },
  },
  {
    name: 'school_set_navigation',
    needs: ['content'],
    description:
      'Replace a navigation menu with the given items, in order. Each item is a label and a URL. ' +
      'The header carries the sections a visitor browses; the footer is where the publications a ' +
      'school is required to keep reachable normally live, so both are settable here.',
    allowedRoles: ['admin'],
    writes: true,
    inputSchema: {
      properties: {
        items: {
          description: 'Menu items, in the order they should appear',
          items: {
            properties: { label: str('Menu label'), url: str('Target URL or path') },
            required: ['label', 'url'],
            type: 'object',
          },
          type: 'array',
        },
        placement: {
          description: 'Which menu to replace: the header (default) or the footer',
          enum: ['header', 'footer'],
          type: 'string',
        },
      },
      required: ['items'],
      type: 'object',
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      const items = (args.items ?? []) as { label: string; url: string }[]
      const placement = args.placement === 'footer' ? 'footer' : 'header'

      const menu = await req.payload.updateGlobal({
        data: {
          navItems: items.map((item) => ({
            link: { type: 'custom', label: item.label, url: item.url },
          })),
        } as never,
        overrideAccess: false,
        req,
        slug: placement,
      })

      return json({
        count: items.length,
        navItems: (menu as { navItems?: unknown }).navItems,
        placement,
      })
    },
  },
]
