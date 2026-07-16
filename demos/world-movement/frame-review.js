const images = [...document.querySelectorAll(".sequence img")];
const loadStatus = document.querySelector("#loadStatus");

function updateLoadStatus() {
  const loaded = images.filter((image) => image.complete && image.naturalWidth > 0).length;
  loadStatus.textContent = `Loaded ${loaded} / ${images.length}`;
}

for (const image of images) {
  image.addEventListener("load", updateLoadStatus);
  image.addEventListener("error", updateLoadStatus);
}

updateLoadStatus();
