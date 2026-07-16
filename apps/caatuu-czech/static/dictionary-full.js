(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("advanced") !== "cz-dictionary") return;

  const $ = (selector) => document.querySelector(selector);
  const panel = $("#fullDictionaryPanel");
  const statusNode = $("#fullDictionaryStatus");
  const availabilityNode = $("#fullDictionaryAvailability");
  const countNode = $("#fullDictionaryCount");
  const resultsNode = $("#fullDictionaryResults");
  const downloadButton = $("#downloadFullDictionary");
  const searchInput = $("#dictionarySearch");
  const dictionaryApi = window.CaatuuRuntime?.dictionary;
  if (!panel || !statusNode || !availabilityNode || !countNode || !resultsNode || !downloadButton || !searchInput) return;

  let searchTimer = null;
  let searchController = null;
  let dictionaryStatus = null;

  document.body.dataset.fullDictionaryDeveloper = "true";
  availabilityNode.hidden = false;
  availabilityNode.textContent = "Checking…";
  searchInput.setAttribute("aria-label", "Search the full Czech to English dictionary");

  function formatNumber(value) {
    return new Intl.NumberFormat("en").format(Number(value || 0));
  }

  function formatMegabytes(value) {
    const bytes = Number(value || 0);
    return bytes > 0 ? `${Math.ceil(bytes / 1024 / 1024)} MB` : "";
  }

  function setAvailability(text, state) {
    availabilityNode.textContent = text;
    availabilityNode.dataset.state = state;
  }

  function showMessage(message) {
    statusNode.textContent = message;
    statusNode.hidden = !message;
  }

  function appendTags(parent, values) {
    const tags = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!tags.length) return;
    const row = document.createElement("span");
    row.className = "full-dictionary-tags";
    tags.slice(0, 6).forEach((value) => {
      const tag = document.createElement("small");
      tag.textContent = value;
      row.append(tag);
    });
    parent.append(row);
  }

  function renderEntry(entry) {
    const card = document.createElement("article");
    card.className = "full-dictionary-entry";

    const header = document.createElement("header");
    const identity = document.createElement("span");
    identity.className = "full-dictionary-identity";
    const lemma = document.createElement("b");
    lemma.textContent = entry.lemma;
    const pos = document.createElement("small");
    pos.textContent = entry.pos || "word";
    identity.append(lemma, pos);

    header.append(identity);
    card.append(header);

    if (entry.matchedBy === "form" && entry.matchedTerm && entry.matchedTerm !== entry.lemma) {
      const matched = document.createElement("p");
      matched.className = "full-dictionary-match";
      matched.textContent = `Form: ${entry.matchedTerm}`;
      card.append(matched);
    }

    const senses = document.createElement("ol");
    senses.className = "full-dictionary-senses";
    (entry.senses || []).forEach((sense) => {
      const item = document.createElement("li");
      const gloss = document.createElement("span");
      gloss.textContent = sense.gloss;
      item.append(gloss);
      appendTags(item, [...(sense.tags || []), ...(sense.topics || [])]);
      (sense.examples || []).forEach((example) => {
        const exampleRow = document.createElement("p");
        exampleRow.className = "full-dictionary-example";
        const czech = document.createElement("em");
        czech.textContent = example.text;
        exampleRow.append(czech);
        if (example.english) {
          const english = document.createElement("span");
          english.textContent = example.english;
          exampleRow.append(english);
        }
        item.append(exampleRow);
      });
      senses.append(item);
    });
    if (senses.children.length) card.append(senses);

    const forms = (entry.forms || []).filter((form) => form.form && form.form !== entry.lemma);
    if (forms.length) {
      const formDetails = document.createElement("details");
      formDetails.className = "full-dictionary-forms";
      const summary = document.createElement("summary");
      summary.textContent = `${forms.length}${entry.forms.length >= 24 ? "+" : ""} forms`;
      const list = document.createElement("p");
      forms.slice(0, 24).forEach((form) => {
        const chip = document.createElement("span");
        chip.textContent = form.form;
        if (form.tags?.length) chip.title = form.tags.join(", ");
        list.append(chip);
      });
      formDetails.append(summary, list);
      card.append(formDetails);
    }

    return card;
  }

  function clearFullResults() {
    panel.hidden = true;
    resultsNode.replaceChildren();
    countNode.textContent = "";
    showMessage("");
    downloadButton.hidden = true;
  }

  function renderPrompt(message, options = {}) {
    panel.hidden = false;
    resultsNode.replaceChildren();
    countNode.textContent = "";
    showMessage(message);
    downloadButton.hidden = !options.download;
    if (options.download) {
      const size = formatMegabytes(dictionaryStatus?.expectedBytes || dictionaryStatus?.bytes);
      downloadButton.textContent = size ? `Download full dictionary · ${size}` : "Download full dictionary";
    }
  }

  function renderSearch(payload) {
    const allResults = Array.isArray(payload.results) ? payload.results : [];
    const isFormOnly = (entry) =>
      Array.isArray(entry.senses) &&
      entry.senses.length > 0 &&
      entry.senses.every((sense) => Array.isArray(sense.tags) && sense.tags.includes("form-of"));
    const hasLexicalResult = allResults.some((entry) => !isFormOnly(entry));
    const results = hasLexicalResult ? allResults.filter((entry) => !isFormOnly(entry)) : allResults;
    panel.hidden = false;
    showMessage("");
    downloadButton.hidden = true;
    countNode.textContent = `${formatNumber(results.length)} result${results.length === 1 ? "" : "s"}`;
    if (!results.length) {
      resultsNode.replaceChildren();
      showMessage("No full-dictionary match.");
      return;
    }
    resultsNode.replaceChildren(...results.map(renderEntry));
  }

  async function runSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      if (dictionaryStatus?.downloadRequired) {
        renderPrompt("Dictionary files are missing on this device. Download them to continue.", { download: true });
      } else if (dictionaryStatus && !dictionaryStatus.available) {
        renderPrompt("The full dictionary is not available on this device.");
      } else {
        clearFullResults();
      }
      return;
    }
    if (!dictionaryStatus?.available) {
      renderPrompt(
        dictionaryStatus?.downloadRequired
          ? "Dictionary files are missing on this device. Download them to continue."
          : "Full-dictionary lookup is not available right now.",
        { download: Boolean(dictionaryStatus?.downloadRequired) }
      );
      return;
    }

    searchController?.abort();
    searchController = new AbortController();
    panel.hidden = false;
    countNode.textContent = "Searching…";
    showMessage("");
    downloadButton.hidden = true;
    try {
      const payload = await dictionaryApi.search(query, {
        limit: 12,
        signal: searchController.signal
      });
      renderSearch(payload);
    } catch (error) {
      if (error.name === "AbortError") return;
      renderPrompt("Full-dictionary search failed. Please try again.");
      setAvailability("Unavailable", "error");
    }
  }

  function scheduleSearch() {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(runSearch, 180);
  }

  async function loadStatus() {
    if (!dictionaryApi) {
      dictionaryStatus = { available: false, downloadRequired: false };
      setAvailability("Unavailable", "error");
      await runSearch();
      return;
    }
    try {
      dictionaryStatus = await dictionaryApi.status();
      if (dictionaryStatus.available) {
        setAvailability("Available", "ready");
      } else if (dictionaryStatus.downloadRequired) {
        setAvailability("Download required", "missing");
      } else {
        setAvailability("Unavailable", "error");
      }
    } catch (error) {
      dictionaryStatus = { available: false, downloadRequired: false };
      setAvailability("Unavailable", "error");
    }
    await runSearch();
  }

  async function downloadDictionary() {
    if (!dictionaryApi?.download) return;
    downloadButton.disabled = true;
    downloadButton.textContent = "Starting download…";
    showMessage("Downloading the full dictionary. Core lookup remains available.");
    try {
      dictionaryStatus = await dictionaryApi.download({
        onEvent(message) {
          if (message.kind !== "progress") return;
          const total = Number(message.totalBytes || dictionaryStatus?.expectedBytes || 0);
          const bytes = Number(message.bytes || 0);
          const percent = total > 0 ? Math.min(100, Math.round(bytes / total * 100)) : 0;
          downloadButton.textContent = `Downloading… ${percent}%`;
        }
      });
      setAvailability("Available", "ready");
      await runSearch();
    } catch (error) {
      renderPrompt("The full dictionary could not be downloaded. Core lookup is still available.", { download: true });
      setAvailability("Download required", "missing");
    } finally {
      downloadButton.disabled = false;
    }
  }

  searchInput.addEventListener("input", scheduleSearch);
  downloadButton.addEventListener("click", downloadDictionary);
  void loadStatus();
})();
