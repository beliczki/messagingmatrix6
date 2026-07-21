// OpenAI Apps SDK widget for the `show_mc_previews` MCP tool. Renders the tool's
// structuredContent ({ name, previews: [{ size, url }] }) as an inline gallery of
// <img> elements in ChatGPT / MCP Inspector. The widget reads the tool output from
// `window.openai.toolOutput` and re-renders on `openai:set_globals`.
//
// Only ChatGPT's Apps SDK host (and MCP Inspector) interpret this resource + the
// tool's _meta.ui / openai/* fields; other MCP clients (e.g. Claude) simply get the
// structuredContent + the text content block.

export const MC_PREVIEWS_TEMPLATE_URI = "ui://widget/mc-previews.html";

export const MC_PREVIEWS_WIDGET_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; color: #0f172a; }
      .mc-previews__name { font-size: 14px; font-weight: 700; margin: 0 0 12px; }
      .mc-previews__gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 16px;
      }
      .mc-previews__figure { margin: 0; }
      .mc-previews__cap { margin: 0 0 6px; font-size: 11px; font-weight: 600; color: #64748b; }
      .mc-previews__img { display: block; max-width: 100%; height: auto; border-radius: 6px; }
      .mc-previews__empty { font-size: 13px; color: #64748b; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      function render(data) {
        var d = data || {};
        var previews = Array.isArray(d.previews) ? d.previews : [];
        var root = document.getElementById("root");
        var name = d.name
          ? '<p class="mc-previews__name">' + esc(d.name) + "</p>"
          : "";
        if (previews.length === 0) {
          root.innerHTML =
            name +
            '<p class="mc-previews__empty">No previews to show yet.</p>';
          return;
        }
        root.innerHTML =
          name +
          '<div class="mc-previews__gallery">' +
          previews
            .map(function (p) {
              return (
                '<figure class="mc-previews__figure">' +
                '<figcaption class="mc-previews__cap">' + esc(p.size) + "</figcaption>" +
                '<img class="mc-previews__img" src="' + esc(p.url) + '" ' +
                'alt="' + esc((d.name || "MC") + " " + p.size) + '" />' +
                "</figure>"
              );
            })
            .join("") +
          "</div>";
      }
      function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
          return {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          }[c];
        });
      }
      render((window.openai && window.openai.toolOutput) || { previews: [] });
      window.addEventListener("openai:set_globals", function (event) {
        var g = event && event.detail && event.detail.globals;
        render(
          (g && g.toolOutput) ||
            (window.openai && window.openai.toolOutput) || { previews: [] },
        );
      });
    </script>
  </body>
</html>`;
