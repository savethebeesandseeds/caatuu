(() => {
  if (globalThis.parent !== globalThis) {
    document.documentElement.classList.add("caatuu-embedded");
    return;
  }

  const course = globalThis.CaatuuCourse;
  const namespace = course?.storage?.namespace || (course?.id ? `caatuu-${course.id}` : "caatuu-course");
  try {
    sessionStorage.setItem(`${namespace}.navigation.request.v1`, "game:word-net");
  } catch (error) {
    // The shell still opens even when session storage is unavailable.
  }
  globalThis.location.replace(course?.routes?.games || "index.html");
})();
