# Dex_Lips public browser test — third-party packages

This Pages site uses version-pinned packages loaded over HTTPS from jsDelivr only when the user starts rendering. Packages are not included in the repository, and no user media is sent to jsDelivr. Loading them contacts the CDN and transmits ordinary network request metadata such as IP address.

- `lip-sync-engine@1.0.3` by biolimbo (MIT), including a WebAssembly Rhubarb Lip Sync speech recognizer and dependencies. https://github.com/biolimbo/lip-sync-engine
- `mediabunny@1.66.2` by Vanilagy (MPL-2.0). https://github.com/Vanilagy/mediabunny
- `@mediabunny/aac-encoder@1.66.2` (MPL-2.0, with underlying FFmpeg codec-license considerations), loaded **only if** the browser lacks a native AAC encoder. https://github.com/Vanilagy/mediabunny

The project source and user-facing code are separate from these packages. All demo media is synthetic and generated for technical validation. There are no private character images, uploaded audio recordings, passwords, access tokens, or repository files from the core Dex_Lips application in this public Pages folder.

This is an experimental user-agent-side tool. The requested codecs and output container should be inspected independently before considering an output production verified. Nothing in this public page grants canonical mouth-art approval for recurring characters.
