export default [
  {
    package: 'govuk_publishing_components',
    lang: 'ruby',
    manager: 'gem',
  },
  {
    package: 'govuk-frontend-jinja',
    lang: 'python',
    manager: 'pip',
    manual: true, // This package does not depend on govuk-frontend, but ports it
  },
]
