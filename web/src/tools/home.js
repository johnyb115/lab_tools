import { initChrome } from '../shared/nav.js'

initChrome('home')

const searchInput = document.getElementById('tool-search')
const categories = document.querySelectorAll('.category-section')
const toolCount = document.getElementById('tool-count')

if (searchInput) {
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim()
    let visible = 0

    categories.forEach((section) => {
      const cards = section.querySelectorAll('.tool-card')
      let sectionVisible = 0

      cards.forEach((card) => {
        const title = card.querySelector('.tool-card__title')?.textContent.toLowerCase() || ''
        const desc = card.querySelector('.tool-card__desc')?.textContent.toLowerCase() || ''
        const keywords = card.dataset.keywords || ''
        const match = !q || title.includes(q) || desc.includes(q) || keywords.includes(q)
        card.style.display = match ? '' : 'none'
        if (match) sectionVisible++
      })

      section.style.display = sectionVisible > 0 ? '' : 'none'
      visible += sectionVisible
    })

    if (toolCount) {
      toolCount.textContent = q ? `${visible} result${visible !== 1 ? 's' : ''}` : '19 tools'
    }
  })
}
