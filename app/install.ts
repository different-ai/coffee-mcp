// The "Add it to your agent" section on the landing page.

interface Client {
  id: string;
  label: string;
  steps: string;
  snippet?: string;
  deeplink?: { href: string; label: string };
}

function clients(url: string): Client[] {
  const cursorConfig = btoa(JSON.stringify({ url }));
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      steps: "Run this in your terminal:",
      snippet: `claude mcp add --transport http coffee ${url}`,
    },
    {
      id: "cursor",
      label: "Cursor",
      steps: "Click to install, or add it to ~/.cursor/mcp.json:",
      snippet: JSON.stringify({ mcpServers: { coffee: { url } } }, null, 2),
      deeplink: {
        href: `cursor://anysphere.cursor-deeplink/mcp/install?name=coffee&config=${encodeURIComponent(cursorConfig)}`,
        label: "Add to Cursor",
      },
    },
    {
      id: "codex",
      label: "Codex",
      steps: "Add this to ~/.codex/config.toml:",
      snippet: `[mcp_servers.coffee]\nurl = "${url}"`,
    },
    {
      id: "vscode",
      label: "VS Code",
      steps: "Run this in your terminal:",
      snippet: `code --add-mcp '${JSON.stringify({ name: "coffee", type: "http", url })}'`,
    },
    {
      id: "openwork",
      label: "OpenWork",
      steps: "Open Settings → Connectors → Add custom MCP, and paste the URL above.",
    },
    {
      id: "chat",
      label: "Claude.ai / ChatGPT",
      steps: "Open Settings → Connectors → Add custom connector, and paste the URL above.",
    },
  ];
}

async function copy(text: string, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select & copy";
  }
  setTimeout(() => (button.textContent = "Copy"), 1600);
}

export function renderInstall(root: HTMLElement, url: string): void {
  root.hidden = false;
  const urlEl = root.querySelector<HTMLElement>("#mcp-url");
  const tabs = root.querySelector<HTMLElement>("#tabs");
  const panel = root.querySelector<HTMLElement>("#panel");
  if (!urlEl || !tabs || !panel) return;
  urlEl.textContent = url;

  root.querySelector<HTMLButtonElement>('[data-copy-target="mcp-url"]')?.addEventListener("click", (e) => {
    if (e.currentTarget instanceof HTMLButtonElement) void copy(url, e.currentTarget);
  });

  const list = clients(url);
  const show = (id: string): void => {
    const client = list.find((c) => c.id === id) ?? list[0];
    if (!client) return;
    for (const tab of tabs.querySelectorAll<HTMLButtonElement>(".tab")) {
      tab.setAttribute("aria-selected", String(tab.dataset.id === client.id));
    }
    panel.replaceChildren();
    const p = document.createElement("p");
    p.textContent = client.steps;
    panel.append(p);
    if (client.snippet) {
      const box = document.createElement("div");
      box.className = "snippet";
      const pre = document.createElement("pre");
      pre.textContent = client.snippet;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy";
      btn.textContent = "Copy";
      const snippet = client.snippet;
      btn.addEventListener("click", () => void copy(snippet, btn));
      box.append(pre, btn);
      panel.append(box);
    }
    if (client.deeplink) {
      const a = document.createElement("a");
      a.className = "deeplink";
      a.href = client.deeplink.href;
      a.textContent = client.deeplink.label;
      panel.append(a);
    }
  };

  for (const client of list) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tab";
    tab.role = "tab";
    tab.dataset.id = client.id;
    tab.textContent = client.label;
    tab.addEventListener("click", () => show(client.id));
    tabs.append(tab);
  }
  show(list[0]?.id ?? "");
}
