// Loading-screen tips. {key:action} is replaced with the player's current binding.
export const TIPS: string[] = [
  "Release the shot at the top of your jump. Better shooters get a wider green window.",
  "Open catch-and-shoot threes and shots at the rim are the most efficient looks in the game.",
  "A pump fake ({key:pumpFake}) can get an eager defender off his feet, but it ends your dribble.",
  "After picking up your dribble you can pivot, pass or shoot. Walking with the ball is a travel.",
  "Crossovers ({key:dribbleLeft} / {key:dribbleRight}) are the quickest way to shake a defender. Time them when he leans.",
  "Hold {key:sprint} to sprint, but it drains stamina. Tired players shoot and defend worse.",
  "Press {key:callScreen} to call for a pick and roll. Read the defense: roll, pop or keep it.",
  "Lobs ({key:lob}) to a cutting big turn into alley-oops when he has a step on his man.",
  "Bounce passes ({key:bounce}) are harder to intercept in traffic.",
  "Hold {key:iconPass} and press a number to pass to a specific teammate.",
  "On defense, stay between your man and the basket. Reaching from behind draws fouls.",
  "Hold {key:intenseD} for an intense defensive stance: quicker slides, but it tires you out.",
  "Jump to block ({key:block}) when the shooter rises, not when he gathers.",
  "Step in front of a driver and stay still to take a charge ({key:takeCharge}).",
  "Press {key:switchPlayer} to switch to the defender closest to the ball.",
  "Press {key:replay} any time to watch the last few seconds again.",
  "Big plays replay automatically. Press {key:shoot} to skip.",
  "Call timeouts ({key:timeout}) to stop a run and give your starters a rest.",
  "Change your defense from the pause menu: a 2-3 zone walls off the paint, a press forces turnovers.",
  "Players in the bonus get free throws on every defensive foul. Watch the foul count on the score bug.",
  "Players on a hot streak shoot a little better. Keep feeding the hot hand.",
  "Each league plays by its own rules: high school has a 35-second shot clock and a shorter three-point line.",
  "Turn on injuries in Settings for a more realistic season feel. Durable players get hurt less.",
  "Gameplay sliders in Settings let you tune shooting, steals, fouls and pace to your taste.",
  "Every binding can be changed in Settings, for the keyboard and for controllers.",
  "After one visit the game works offline, and you can install it as an app.",
  "Bench players react to your big plays. Give them something to cheer about.",
  "Fatigue builds over a game. The coach subs tired players automatically unless you turn it off.",
];

export function formatTip(tip: string, label: (action: string) => string) {
  return tip.replace(/\{key:(\w+)\}/g, (_, a: string) => label(a));
}
