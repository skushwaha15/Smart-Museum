// ------------------ CONFIG ------------------
const BASE_URL = "https://smart-museum-0xgs.onrender.com";

const chatMessages = document.getElementById("chat-messages");
const chatOptions = document.getElementById("chat-options");


// ------------------ Message Function ------------------

function addMessage(message, isUser = false) {

    const msgDiv = document.createElement("div");
    msgDiv.className = isUser ? "message user-message" : "message bot-message";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    contentDiv.textContent = message;

    msgDiv.appendChild(contentDiv);
    chatMessages.appendChild(msgDiv);

    chatMessages.scrollTop = chatMessages.scrollHeight;
}



// ------------------ MAIN MENU ------------------

function showMainMenu(){



chatOptions.innerHTML = `

<div class="option-button">🎟️ Ticket Booking</div>

<div class="option-button">🗓️ Visit Planning</div>

<div class="option-button">🏢 Facilities & Safety</div>

<div class="option-button">🎓 Experience & Education</div>

`;

document.querySelectorAll(".option-button").forEach(btn => {

btn.onclick = () => showSubMenu(btn.textContent);

});

}



// ------------------ SUB MENU ------------------

function showSubMenu(category){

addMessage(category,true);


// Ticket Booking

if(category.includes("Ticket")){

addMessage("How can I help you with ticket booking?");

chatOptions.innerHTML = `

<div class="option-button">Will I be allowed entry if I arrive late?</div>

<div class="option-button">Is a mobile ticket acceptable or do I need a printed ticket?</div>

<div class="option-button">My payment was deducted but I did not receive a ticket. What should I do?</div>

<div class="option-button">When will I receive my refund?</div>

<div class="option-button">⬅ Back</div>

`;

}


// Visit Planning

else if(category.includes("Visit")){

addMessage("Need help planning your visit?");

chatOptions.innerHTML = `

<div class="option-button">When is the least crowded time to visit?</div>

<div class="option-button">Is morning better or evening for visiting the museum?</div>

<div class="option-button">Will it be comfortable to visit during summer?</div>

<div class="option-button">Is the museum open during rain?</div>

<div class="option-button">⬅ Back</div>

`;

}


// Facilities

else if(category.includes("Facilities")){

addMessage("What would you like to know about facilities?");

chatOptions.innerHTML = `

<div class="option-button">Where are the washrooms located?</div>

<div class="option-button">Is drinking water available inside the museum?</div>

<div class="option-button">Is a wheelchair available for visitors?</div>

<div class="option-button">What should I do if a child gets lost inside the museum?</div>

<div class="option-button">⬅ Back</div>

`;

}


// Experience

else if(category.includes("Experience")){

addMessage("Ask about the museum experience:");

chatOptions.innerHTML = `

<div class="option-button">Is a guide available inside the museum?</div>

<div class="option-button">Is an audio guide available for visitors?</div>

<div class="option-button">Can I take photos or make reels inside the museum?</div>

<div class="option-button">Can students take photos for academic projects?</div>

<div class="option-button">⬅ Back</div>

`;

}



document.querySelectorAll(".option-button").forEach(btn => {

btn.onclick = () => handleAnswer(btn.textContent);

});

}



// ------------------ ANSWERS ------------------

function handleAnswer(question){

if(question==="⬅ Back"){

chatOptions.innerHTML="";

showMainMenu();

return;

}

addMessage(question,true);


const answers = {


"Will I be allowed entry if I arrive late?":

"Yes, entry is usually allowed within a short grace period. Please check with staff.",


"Is a mobile ticket acceptable or do I need a printed ticket?":

"Mobile tickets are accepted. Printing is not required.",


"My payment was deducted but I did not receive a ticket. What should I do?":

"Please check your email or contact the museum support desk.",


"When will I receive my refund?":

"Refunds are processed within 5-7 working days.",


"When is the least crowded time to visit?":

"Weekday mornings are the least crowded.",


"Is morning better or evening for visiting the museum?":

"Morning is recommended for the best experience.",


"Will it be comfortable to visit during summer?":

"Yes, museums are air-conditioned.",


"Is the museum open during rain?":

"Yes, museums remain open during rain.",


"Where are the washrooms located?":

"Washrooms are available near the entrance.",


"Is drinking water available inside the museum?":

"Yes, drinking water is available.",


"Is a wheelchair available for visitors?":

"Yes, wheelchair facility is available.",


"What should I do if a child gets lost inside the museum?":

"Contact museum staff immediately.",


"Is a guide available inside the museum?":

"Yes, guides are available.",


"Is an audio guide available for visitors?":

"No, audio guides are not available.",


"Can I take photos or make reels inside the museum?":

"Yes, photography is allowed without flash.",


"Can students take photos for academic projects?":

"Yes, academic photography is allowed."

};


addMessage(answers[question]);


}



// ------------------ INIT ------------------

showMainMenu();
