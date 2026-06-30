/* Shared quiz widget for the Data Liberation course.
   Markup contract (built once, reused by every lesson):

   <div class="quiz" data-answer="1">
     <div class="q">Question text…</div>
     <ul class="opts">
       <li><button class="opt">First option</button></li>
       <li><button class="opt">Second option</button></li>
       ...
     </ul>
     <div class="feedback" data-correct="Why this is right." data-wrong="Nudge."></div>
   </div>

   data-answer is the 0-based index of the correct option. Options are deliberately
   matched in length (no formatting tells). Feedback strings live on .feedback. */

(function () {
  function initQuiz(quiz) {
    const answer = parseInt(quiz.getAttribute('data-answer'), 10);
    const buttons = Array.from(quiz.querySelectorAll('button.opt'));
    const feedback = quiz.querySelector('.feedback');
    let done = false;

    buttons.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        if (done) return;
        done = true;
        const correct = i === answer;
        btn.classList.add(correct ? 'correct' : 'wrong');
        if (!correct) buttons[answer].classList.add('correct');
        if (feedback) {
          feedback.textContent = correct
            ? (feedback.getAttribute('data-correct') || 'Correct.')
            : (feedback.getAttribute('data-wrong') || 'Not quite — see the highlighted answer.');
          feedback.classList.add(correct ? 'correct' : 'wrong');
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.quiz').forEach(initQuiz);
  });
})();
