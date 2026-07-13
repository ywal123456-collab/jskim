(function () {
  var helpModal = document.getElementById('help-modal');
  var openHelp = document.getElementById('open-help');
  var closeHelp = document.getElementById('close-help');
  var openDetails = document.getElementById('open-details');
  var details = document.getElementById('extra-details');

  if (openHelp && helpModal) {
    openHelp.addEventListener('click', function () {
      helpModal.classList.add('is-open');
      helpModal.setAttribute('aria-hidden', 'false');
    });
  }

  if (closeHelp && helpModal) {
    closeHelp.addEventListener('click', function () {
      helpModal.classList.remove('is-open');
      helpModal.setAttribute('aria-hidden', 'true');
    });
  }

  if (openDetails && details) {
    openDetails.addEventListener('click', function () {
      details.open = true;
    });
  }
})();
