export const DEFAULT_BASE_URL = "https://api.octen.ai";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 3;

export const ENDPOINTS = {
  search: "/search",
  broadSearch: "/broad-search",
  extract: "/extract",
  embedding: "/embedding",
  vlEmbedding: "/vl-embedding",
  chat: "/v1/chat/completions",
  imageSearch: "/image-search",
  videoSearch: "/video-search",
} as const;

export const EMBEDDING_MODELS: Record<string, string> = {
  "0.6b": "octen-embedding-0.6b",
  "4b": "octen-embedding-4b",
  "8b": "octen-embedding-8b",
};
export const VL_EMBEDDING_MODELS: Record<string, string> = {
  base: "octen-vl-embedding",
  large: "octen-vl-embedding-large",
};

export const LIMITS = {
  searchCount: { min: 1, max: 100 },
  maxQueries: { min: 1, max: 30 },
  includeText: 5,
  excludeText: 5,
  extractUrls: { min: 1, max: 20 },
  extractTimeout: { min: 1, max: 60 },
  cacheWindow: { min: 300, max: 31_536_000, default: 86_400 },
  highlightMaxTokens: { min: 100 },
  vlContents: 20,
  vlImages: 5,
  vlVideos: 1,
  imageCount: { min: 1, max: 10 },
  videoCount: { min: 1, max: 10 },
} as const;

export const TOPIC_OPTIONS = ["general", "news"] as const;
export const IMAGE_TOPIC_OPTIONS = ["general", "design"] as const;
export const TIME_BASIS_OPTIONS = ["auto", "published", "crawled"] as const;
export const TIME_RANGE_OPTIONS = ["day", "week", "month", "year", "d", "w", "m", "y"] as const;
export const SAFESEARCH_OPTIONS = ["off", "strict"] as const;
export const FORMAT_OPTIONS = ["text", "markdown"] as const;

export const SKILLS_REPO = "Octen-Team/octen-skills";
export const SKILLS_REPO_TARBALL = (ref: string) =>
  `https://github.com/${SKILLS_REPO}/archive/${ref}.tar.gz`;
