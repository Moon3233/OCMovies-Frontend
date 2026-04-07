function openModal() {
    document.getElementById('modal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  /* Fermer en cliquant sur l'overlay */
  document.getElementById('modal-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

  /* Fermer avec Échap */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  /* Mise à jour du titre de section selon le select */
  document.getElementById('cat-select').addEventListener('change', function () {
    const val = this.value;
    document.getElementById('dynamic-title').textContent = val;
  });