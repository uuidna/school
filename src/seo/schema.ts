/**
 * What a school looks like to a machine that is not a browser.
 *
 * A school's site is read by more than parents. Google decides from it whether
 * to show the school as a place with an address; the ministry's crawlers and
 * the open-data aggregators decide whether its statutory documents exist at
 * all. All of them read schema.org, and a site that omits it is a site that
 * publishes 260 mandated documents into a shape nothing can enumerate.
 *
 * Three rules hold this module together:
 *
 *  - It states only what it was given. Every optional field is dropped when
 *    absent rather than filled with a plausible default, because the failure
 *    mode of structured data is not an empty field — it is a confident wrong
 *    one, republished by everything downstream. A school whose street is
 *    unknown says nothing about its street.
 *  - Nodes refer to each other by `@id` instead of repeating. One `@graph` per
 *    page, one organisation node in it, and the page, the breadcrumb and the
 *    article all point at that node.
 *  - It is pure. No Payload, no environment, no fetch — the caller binds the
 *    school's identity and the page's content. That is what makes it the same
 *    code for the second school.
 *
 * Serialising is not `JSON.stringify`. See {@link jsonLd}.
 */

/** The parts of a postal address worth stating; each omitted when unknown. */
export type SchoolAddress = {
  country: string
  locality: string
  postalCode?: string
  region?: string
  street?: string
}

/**
 * The school as published — what a reader of the site can see, and nothing
 * more. Named away from `SchoolIdentity` (a person within a school) and
 * `SchoolProfile` (what a funder assesses), because the three are different
 * and a school's public name is the only one of them safe to emit.
 *
 * Supplied by the deployment, never defaulted here: a package that guesses a
 * name gives every school the first school's.
 */
export type PublishedSchool = {
  address?: SchoolAddress
  description?: string
  email?: string
  /** Absolute URL of the logo. */
  logo?: string
  name: string
  /** Profiles that are demonstrably the same school. */
  sameAs?: string[]
  telephone?: string
  /**
   * The schema.org type. `School` fits any school; a Bulgarian професионална
   * гимназия is more precisely a `HighSchool`, and saying so is the difference
   * between appearing in a search for secondary schools and not.
   */
  type?: 'CollegeOrUniversity' | 'EducationalOrganization' | 'ElementarySchool' | 'HighSchool' | 'MiddleSchool' | 'School'
  /** Origin, no trailing slash. */
  url: string
}

export type Thing = Record<string, unknown>

/** Drops keys whose value is absent or empty, so absence stays absence. */
const stated = <T extends Thing>(thing: T): T =>
  Object.fromEntries(
    Object.entries(thing).filter(
      ([, value]) =>
        value !== undefined &&
        value !== null &&
        value !== '' &&
        !(Array.isArray(value) && value.length === 0),
    ),
  ) as T

const trimSlash = (url: string): string => url.replace(/\/+$/, '')

/** `#organisation`, `#website` — the stable fragment ids other nodes point at. */
export const idOf = (url: string, fragment: string): string => `${trimSlash(url)}/#${fragment}`

const ORGANISATION = 'organisation'
const WEBSITE = 'website'

/** A reference to a node stated elsewhere in the same graph. */
const ref = (id: string): Thing => ({ '@id': id })

export const postalAddress = (address: SchoolAddress): Thing =>
  stated({
    '@type': 'PostalAddress',
    addressCountry: address.country,
    addressLocality: address.locality,
    addressRegion: address.region,
    postalCode: address.postalCode,
    streetAddress: address.street,
  })

/** The school itself. Everything else on the page is about this node. */
export const organisation = (school: PublishedSchool): Thing =>
  stated({
    '@id': idOf(school.url, ORGANISATION),
    '@type': school.type ?? 'School',
    address: school.address ? postalAddress(school.address) : undefined,
    description: school.description,
    email: school.email,
    logo: school.logo ? stated({ '@type': 'ImageObject', url: school.logo }) : undefined,
    name: school.name,
    sameAs: school.sameAs,
    telephone: school.telephone,
    url: trimSlash(school.url),
  })

/**
 * The site.
 *
 * `searchPath` adds a SearchAction, which tells a search engine it may offer a
 * search box for this site. It is stated only when the site really has one:
 * advertising a search endpoint that 404s is worse than having no search.
 */
export const webSite = (
  school: PublishedSchool,
  options: { inLanguage?: string; searchPath?: string } = {},
): Thing => {
  const url = trimSlash(school.url)
  return stated({
    '@id': idOf(url, WEBSITE),
    '@type': 'WebSite',
    description: school.description,
    inLanguage: options.inLanguage,
    name: school.name,
    potentialAction: options.searchPath
      ? {
          '@type': 'SearchAction',
          'query-input': 'required name=search_term_string',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${url}${options.searchPath}{search_term_string}`,
          },
        }
      : undefined,
    publisher: ref(idOf(url, ORGANISATION)),
    url,
  })
}

export type Crumb = { name: string; url?: string }

/**
 * The trail. The last crumb is the current page and carries no `item`, which
 * is what stops a search engine linking a page to itself.
 */
export const breadcrumbs = (crumbs: Crumb[], id?: string): Thing =>
  stated({
    '@id': id,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) =>
      stated({
        '@type': 'ListItem',
        item: index === crumbs.length - 1 ? undefined : crumb.url,
        name: crumb.name,
        position: index + 1,
      }),
    ),
  })

export type PageFacts = {
  breadcrumb?: Crumb[]
  dateModified?: string
  datePublished?: string
  description?: string
  image?: string
  inLanguage?: string
  /** `WebPage` unless the page is a listing (`CollectionPage`) or a search. */
  type?: 'AboutPage' | 'CollectionPage' | 'ContactPage' | 'SearchResultsPage' | 'WebPage'
  title: string
  /** Absolute. */
  url: string
}

export const webPage = (school: PublishedSchool, facts: PageFacts): Thing => {
  const site = trimSlash(school.url)
  return stated({
    '@id': `${facts.url}#page`,
    '@type': facts.type ?? 'WebPage',
    about: ref(idOf(site, ORGANISATION)),
    breadcrumb: facts.breadcrumb?.length
      ? breadcrumbs(facts.breadcrumb, `${facts.url}#breadcrumb`)
      : undefined,
    dateModified: facts.dateModified,
    datePublished: facts.datePublished,
    description: facts.description,
    inLanguage: facts.inLanguage,
    isPartOf: ref(idOf(site, WEBSITE)),
    name: facts.title,
    primaryImageOfPage: facts.image ? stated({ '@type': 'ImageObject', url: facts.image }) : undefined,
    url: facts.url,
  })
}

export type ArticleFacts = PageFacts & {
  authors?: string[]
  /** `NewsArticle` for school news; `Article` for anything longer-lived. */
  articleType?: 'Article' | 'NewsArticle' | 'Report'
}

export const article = (school: PublishedSchool, facts: ArticleFacts): Thing => {
  const site = trimSlash(school.url)
  const organisationRef = ref(idOf(site, ORGANISATION))
  return stated({
    '@id': `${facts.url}#article`,
    '@type': facts.articleType ?? 'NewsArticle',
    author: facts.authors?.length
      ? facts.authors.map((name) => ({ '@type': 'Person', name }))
      : organisationRef,
    dateModified: facts.dateModified ?? facts.datePublished,
    datePublished: facts.datePublished,
    description: facts.description,
    headline: facts.title,
    image: facts.image,
    inLanguage: facts.inLanguage,
    isPartOf: ref(`${facts.url}#page`),
    mainEntityOfPage: ref(`${facts.url}#page`),
    publisher: organisationRef,
  })
}

/**
 * One of the school's mandated documents.
 *
 * This is the reason the module exists. A Bulgarian school must publish its
 * budget, its rules and its plans; there is no schema.org type for „required
 * by чл. 263", so each is a `DigitalDocument` with its format and date, and the
 * listing that holds them is an {@link itemList}. That makes the school's
 * statutory publication enumerable by something other than a human reading a
 * page of links.
 */
export type DocumentFacts = {
  /**
   * The provision the document is published under, as the authority words it —
   * „ЗПУО чл. 263, ал. 2, т. 1". There is no schema.org property for „required
   * by", so it is stated as a citation of the legislation, which is true and
   * which a reader looking for the school's statutory publication can follow.
   */
  citesLegislation?: string
  dateModified?: string
  datePublished?: string
  /** MIME type, e.g. `application/pdf`. */
  encodingFormat?: string
  name: string
  sizeBytes?: number
  url: string
}

export const digitalDocument = (school: PublishedSchool, facts: DocumentFacts): Thing =>
  stated({
    '@type': 'DigitalDocument',
    citation: facts.citesLegislation
      ? stated({ '@type': 'Legislation', name: facts.citesLegislation })
      : undefined,
    contentSize: facts.sizeBytes === undefined ? undefined : String(facts.sizeBytes),
    dateModified: facts.dateModified,
    datePublished: facts.datePublished,
    encodingFormat: facts.encodingFormat,
    name: facts.name,
    publisher: ref(idOf(school.url, ORGANISATION)),
    url: facts.url,
  })

/**
 * An ordered list of things the page links to.
 *
 * `position` is 1-based and must be, or the list is read as unordered.
 */
export const itemList = (
  items: (string | Thing)[],
  options: { id?: string; name?: string } = {},
): Thing =>
  stated({
    '@id': options.id,
    '@type': 'ItemList',
    itemListElement: items.map((item, index) =>
      stated({
        '@type': 'ListItem',
        item: typeof item === 'string' ? undefined : item,
        position: index + 1,
        url: typeof item === 'string' ? item : undefined,
      }),
    ),
    name: options.name,
    numberOfItems: items.length,
  })

export const imageObject = (facts: {
  caption?: string
  height?: number
  name?: string
  url: string
  width?: number
}): Thing =>
  stated({
    '@type': 'ImageObject',
    caption: facts.caption,
    contentUrl: facts.url,
    height: facts.height,
    name: facts.name,
    url: facts.url,
    width: facts.width,
  })

/** One page's nodes, cross-referenced, as a single graph. */
export const graph = (nodes: (null | Thing | undefined)[]): Thing => ({
  '@context': 'https://schema.org',
  '@graph': nodes.filter((node): node is Thing => Boolean(node)),
})

/**
 * The text that goes inside `<script type="application/ld+json">`.
 *
 * `JSON.stringify` is not enough and this is not a style preference. Inside a
 * script element the HTML parser is still looking for `</script`, so a page
 * title containing one — and a title is editor-supplied text — closes the
 * script early and everything after it becomes markup. Escaping `<` as `<`
 * is valid JSON, parses to the same string, and cannot end the element.
 *
 * `&` and the line separators are escaped for the same family of reasons: JSON
 * permits raw U+2028 in strings and JavaScript does not.
 */
export const jsonLd = (value: Thing): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/[\u2028\u2029]/g, (ch) => (ch === '\u2028' ? '\\u2028' : '\\u2029'))
