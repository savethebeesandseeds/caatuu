// Course scope only. All authored Case Cosmos content lives in content.json.
export function assertEnglishCzechCourse(course) {
  if (course?.id !== "cz" || course.sourceLanguage?.id !== "en"
      || !/^en(?:-[A-Za-z]+)*$/u.test(course.sourceLanguage?.locale || "")
      || course.targetLanguage?.id !== "cs" || course.targetLanguage?.locale !== "cs-CZ") {
    throw new Error("Case Cosmos content requires the English -> Czech course.");
  }
}
